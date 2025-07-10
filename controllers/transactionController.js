// controllers/transactionController.js
const jwt = require("jsonwebtoken"); 
// Nouveau et CORRECT pour stellar-sdk@13.3.0:
const StellarSdk = require("@stellar/stellar-sdk");
const { Keypair, TransactionBuilder, Operation, Asset, Networks } = StellarSdk;
// Accédez à Server via StellarSdk.Horizon
const Server = StellarSdk.Horizon.Server; // <-- C'est ça la clé !
const axios = require("axios"); // Pour faire des requêtes HTTP aux APIs de TestAnchor
const User = require("../models/User"); // Nous aurons besoin du modèle User
const mongoose = require("mongoose"); // Pour les sessions de transaction MongoDB

// --- Configurations Stellar & TestAnchor ---
const STELLAR_SERVER = new Server(process.env.HORIZON_URL);
const STELLAR_NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK === 'public' ? Networks.PUBLIC : Networks.TESTNET;

const AFRISWIFT_BACKEND_KEYPAIR = process.env.AFRISWIFT_BACKEND_STELLAR_SECRET
  ? Keypair.fromSecret(process.env.AFRISWIFT_BACKEND_STELLAR_SECRET)
  : null;

if (!AFRISWIFT_BACKEND_KEYPAIR) {
  console.error("ERREUR: La clé secrète du backend AfriSwift (AFRISWIFT_BACKEND_STELLAR_SECRET) n'est pas configurée dans .env");
  process.exit(1); // Arrête l'application si non configuré
}

const TEST_ANCHOR_ASSET_CODE = process.env.TEST_ANCHOR_ASSET_CODE;
const TEST_ANCHOR_ASSET_ISSUER = process.env.TEST_ANCHOR_ASSET_ISSUER;
const TEST_ANCHOR_SRT_ASSET = new Asset(TEST_ANCHOR_ASSET_CODE, TEST_ANCHOR_ASSET_ISSUER);

const TEST_ANCHOR_AUTH_ENDPOINT = process.env.TEST_ANCHOR_AUTH_ENDPOINT;
const TEST_ANCHOR_TRANSFER_SERVER_SEP6 = process.env.TEST_ANCHOR_TRANSFER_SERVER_SEP6;

// --- Cache pour le token SEP-0010 (pour éviter de le redemander à chaque requête) ---
let sep10AuthToken = null;
let sep10TokenExpiry = 0; // Timestamp de l'expiration

// --- Fonction Utilitaire : Authentification SEP-0010 avec TestAnchor ---
// Cette fonction permet à votre backend AfriSwift de s'authentifier auprès de TestAnchor
async function getSep10AuthToken() {
    // Renouveler le token si expiré ou sur le point d'expirer (dans la prochaine minute)
    if (sep10AuthToken && sep10TokenExpiry > Date.now() + 60 * 1000) {
        return sep10AuthToken;
    }

    try {
        // 1. Récupérer le challenge transaction depuis TestAnchor
        const challengeResponse = await axios.get(`${TEST_ANCHOR_AUTH_ENDPOINT}?account=${AFRISWIFT_BACKEND_KEYPAIR.publicKey()}`);
        const challengeXDR = challengeResponse.data.transaction;

        // 2. Décoder la transaction de challenge et la signer avec la clé de votre backend AfriSwift
        const transaction = TransactionBuilder.fromXDR(challengeXDR, STELLAR_NETWORK_PASSPHRASE);
        transaction.sign(AFRISWIFT_BACKEND_KEYPAIR); // Votre backend signe le challenge

        // 3. Soumettre la transaction signée à TestAnchor pour obtenir le token JWT
        const submitResponse = await axios.post(TEST_ANCHOR_AUTH_ENDPOINT, new URLSearchParams({
            transaction: transaction.toXDR()
        }).toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        sep10AuthToken = submitResponse.data.token;
        // Pour une meilleure gestion, décodez le JWT pour extraire 'exp' (expiration time)
        // Pour l'MVP, on estime une validité de 24h si pas d'info 'exp' dans le token
        const decodedToken = jwt.decode(sep10AuthToken);
        if (decodedToken && decodedToken.exp) {
            sep10TokenExpiry = decodedToken.exp * 1000; // Convertir secondes en millisecondes
        } else {
            sep10TokenExpiry = Date.now() + (24 * 60 * 60 * 1000); // 24 heures par défaut
        }

        console.log("Token SEP-0010 obtenu avec succès !");
        return sep10AuthToken;

    } catch (error) {
        console.error("Erreur lors de l'authentification SEP-0010 avec TestAnchor :", error.response ? error.response.data : error.message);
        throw new Error("Impossible d'authentifier le backend AfriSwift auprès de TestAnchor.");
    }
}

// --- NOUVELLE FONCTION : Enregistrer les informations bancaires de l'utilisateur ---
exports.enregistrerInfosBancaires = async (req, res) => {
    try {
        const userId = req.utilisateur.id; // ID de l'utilisateur connecté
        const {
            bankAccountNumber,
            bankAccountType,
            bankName,
            bankBranch,
            bankClearingCode
        } = req.body;

        // Validation simple des champs
        if (!bankAccountNumber || !bankAccountType || !bankName) {
            return res.status(400).json({ message: "Les champs numéro de compte, type de compte et nom de la banque sont requis." });
        }

        const utilisateur = await User.findById(userId);
        if (!utilisateur) {
            return res.status(404).json({ message: "Utilisateur non trouvé." });
        }

        // Stocker les informations bancaires dans le document de l'utilisateur
        utilisateur.bankDetails = {
            bankAccountNumber,
            bankAccountType,
            bankName,
            bankBranch: bankBranch || null, // Optionnel
            bankClearingCode: bankClearingCode || null // Optionnel
        };
        utilisateur.dateMiseAJour = Date.now();
        await utilisateur.save();

        res.status(200).json({
            message: "Informations bancaires enregistrées avec succès.",
            bankDetails: utilisateur.bankDetails
        });

    } catch (error) {
        console.error("Erreur lors de l'enregistrement des informations bancaires :", error);
        res.status(500).json({ message: "Erreur interne du serveur lors de l'enregistrement des informations bancaires." });
    }
};


// --- Fonction RENOMMÉE : Dépôt Bancaire (simulé) vers SRT (TestAnchor) ---
exports.depotBancaireVersStellar = async (req, res) => {
    // Cette fonction simule l'arrivée de fonds via un dépôt bancaire
    // et leur conversion en SRT par TestAnchor.
    // EN PRODUCTION, CECI SERAIT DÉCLENCHÉ PAR UN WEBHOOK DE VOTRE FOURNISSEUR BANCAIRE
    // APRÈS CONFIRMATION DE PAIEMENT, NON PAR UNE REQUÊTE UTILISATEUR DIRECTE.

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { montantXOF } = req.body; // Montant déclaré en XOF (monnaie locale)
        const userId = req.utilisateur.id; // ID de l'utilisateur expéditeur

        const utilisateur = await User.findById(userId).session(session);
        if (!utilisateur) {
            await session.abortTransaction();
            return res.status(404).json({ message: "Utilisateur non trouvé." });
        }
        if (utilisateur.kyc.etat !== "approuvé") {
            await session.abortTransaction();
            return res.status(403).json({ message: "Votre compte n'est pas vérifié (KYC non approuvé). Impossible d'effectuer un dépôt." });
        }
        if (utilisateur.statusCompte !== "actif") {
            await session.abortTransaction();
            return res.status(403).json({ message: "Votre compte est bloqué. Impossible d'effectuer un dépôt." });
        }

        // --- Vérifier si les informations bancaires sont enregistrées ---
        if (!utilisateur.bankDetails || !utilisateur.bankDetails.bankAccountNumber) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Veuillez d'abord enregistrer vos informations bancaires pour effectuer un dépôt." });
        }

        const montantXOFNumerique = parseFloat(montantXOF);
        if (isNaN(montantXOFNumerique) || montantXOFNumerique <= 0) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Montant de dépôt invalide." });
        }

        // --- SIMULATION de la conversion XOF -> SRT ---
        const tauxDeConversionXOFVersSRT = 0.1; // Exemple: 10 XOF = 1 SRT
        const montantSRT = montantXOFNumerique * tauxDeConversionXOFVersSRT;

        // --- Vérifier l'existence de la Trustline SRT pour l'utilisateur ---
        const hasSRTTrustline = utilisateur.trustlines.some(tl =>
            tl.assetCode === TEST_ANCHOR_ASSET_CODE &&
            tl.issuer === TEST_ANCHOR_ASSET_ISSUER &&
            tl.established
        );
        if (!hasSRTTrustline) {
            await session.abortTransaction();
            return res.status(400).json({ message: `Veuillez d'abord établir une trustline pour l'actif ${TEST_ANCHOR_ASSET_CODE} (TestAnchor) sur votre compte Stellar. Contactez le support.` });
        }

        // 1. Obtenir le token d'authentification SEP-0010
        const sep10Token = await getSep10AuthToken();

        // 2. Appeler l'API /deposit de TestAnchor (SEP-0006)
        // Utilisation des informations bancaires stockées et des noms/email de l'utilisateur
        const depositResponse = await axios.get(`${TEST_ANCHOR_TRANSFER_SERVER_SEP6}/deposit`, {
            headers: {
                'Authorization': `Bearer ${sep10Token}`
            },
            params: {
                asset_code: TEST_ANCHOR_ASSET_CODE,
                account: utilisateur.compteStellar.clePublique,
                type: "bank_account", // Type de dépôt attendu par l'anchor
                bank_account_number: utilisateur.bankDetails.bankAccountNumber,
                bank_account_type: utilisateur.bankDetails.bankAccountType,
                bank_name: utilisateur.bankDetails.bankName,
                bank_branch: utilisateur.bankDetails.bankBranch || "",
                bank_clearing_code: utilisateur.bankDetails.bankClearingCode || "",
                first_name: utilisateur.firstName, // Récupéré de l'utilisateur en DB
                last_name: utilisateur.lastName,   // Récupéré de l'utilisateur en DB
                email_address: utilisateur.email   // Récupéré de l'utilisateur en DB
            }
        });

        // 3. Mettre à jour le solde interne de l'utilisateur dans la DB
        utilisateur.solde.SRT = (utilisateur.solde.SRT || 0) + montantSRT;
        utilisateur.dateMiseAJour = Date.now();
        await utilisateur.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            message: `Dépôt bancaire simulé. ${montantSRT} ${TEST_ANCHOR_ASSET_CODE} seront crédités sur votre compte Stellar par TestAnchor.`,
            montantDeclareXOF: montantXOFNumerique,
            montantEstimeSRT: montantSRT,
            nouveauSoldeSRTInterne: utilisateur.solde.SRT,
            stellarDepositDetails: depositResponse.data
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Erreur lors du dépôt bancaire vers Stellar :", error.response ? error.response.data : error.message);
        let errorMessage = "Erreur lors du traitement du dépôt.";
        if (error.response && error.response.data) {
            errorMessage = error.response.data.error || JSON.stringify(error.response.data);
        }
        res.status(500).json({ message: errorMessage });
    }
};

// --- Contrôleur : Effectuer une transaction SRT (P2P) ---
exports.effectuerTransactionStellar = async (req, res) => {
    // Cette fonction gère une transaction directe de SRT de l'expéditeur au destinataire sur le réseau Stellar.
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { destinataireNumeroCompte, montant } = req.body;
        const expeditorId = req.utilisateur.id;

        // 1. Vérifier expéditeur et destinataire
        const expeditor = await User.findById(expeditorId).select('+compteStellar.cleSecrete').session(session);
        if (!expeditor) {
            await session.abortTransaction();
            return res.status(404).json({ message: "Expéditeur non trouvé." });
        }
        if (expeditor.kyc.etat !== "approuvé" || expeditor.statusCompte !== "actif") {
            await session.abortTransaction();
            return res.status(403).json({ message: "Compte expéditeur non autorisé pour les transactions." });
        }

        const destinataire = await User.findOne({ numeroCompte: destinataireNumeroCompte }).session(session);
        if (!destinataire) {
            await session.abortTransaction();
            return res.status(404).json({ message: "Destinataire non trouvé avec ce numéro de compte AfriSwift." });
        }
        if (expeditor._id.toString() === destinataire._id.toString()) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Vous ne pouvez pas vous envoyer de l'argent à vous-même." });
        }

        const montantNumerique = parseFloat(montant);
        if (isNaN(montantNumerique) || montantNumerique <= 0) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Montant de transaction invalide." });
        }

        // 2. Vérifier le solde SRT interne de l'expéditeur (pour éviter les soucis on-chain si le solde DB est faux)
        if (expeditor.solde.SRT < montantNumerique) {
            await session.abortTransaction();
            return res.status(400).json({ message: `Solde interne ${TEST_ANCHOR_ASSET_CODE} insuffisant. Solde actuel: ${expeditor.solde.SRT} ${TEST_ANCHOR_ASSET_CODE}.` });
        }

        // 3. Charger le compte Stellar de l'expéditeur
        const expeditorKeyPair = Keypair.fromSecret(expeditor.compteStellar.cleSecrete);
        let expeditorStellarAccount;
        try {
            expeditorStellarAccount = await STELLAR_SERVER.loadAccount(expeditor.compteStellar.clePublique);
        } catch (error) {
            await session.abortTransaction();
            console.error("Erreur de chargement du compte Stellar de l'expéditeur :", error);
            return res.status(500).json({ message: "Impossible de charger le compte Stellar de l'expéditeur. Assurez-vous qu'il est activé et a un solde minimum de XLM." });
        }

        // 4. Vérifier que l'expéditeur a assez de SRT (on-chain)
        const expeditorSRTBalance = expeditorStellarAccount.balances.find(
            b => b.asset_code === TEST_ANCHOR_ASSET_CODE && b.asset_issuer === TEST_ANCHOR_ASSET_ISSUER
        );
        const currentSRTStellarBalance = parseFloat(expeditorSRTBalance ? expeditorSRTBalance.balance : 0);

        if (currentSRTStellarBalance < montantNumerique) {
            await session.abortTransaction();
            return res.status(400).json({ message: `Solde ${TEST_ANCHOR_ASSET_CODE} insuffisant sur votre compte Stellar. Solde actuel: ${currentSRTStellarBalance} ${TEST_ANCHOR_ASSET_CODE}.` });
        }

        // 5. Construire et signer la transaction Stellar
        const baseFee = await STELLAR_SERVER.fetchBaseFee(); // Récupère le minimum de frais pour le réseau
        const transaction = new TransactionBuilder(expeditorStellarAccount, {
            fee: baseFee,
            networkPassphrase: STELLAR_NETWORK_PASSPHRASE
        })
        .addOperation(
            Operation.payment({
                destination: destinataire.compteStellar.clePublique,
                asset: TEST_ANCHOR_SRT_ASSET, // Utilise l'actif SRT de TestAnchor
                amount: montantNumerique.toString()
            })
        )
        .setTimeout(30)
        .build();

        transaction.sign(expeditorKeyPair);

        // 6. Soumettre la transaction au réseau Stellar
        const transactionResponse = await STELLAR_SERVER.submitTransaction(transaction);
        console.log("Stellar P2P SRT Transaction Response:", transactionResponse);

        // 7. Mettre à jour les soldes internes des utilisateurs dans la base de données
        // Débiter l'expéditeur
        expeditor.solde.SRT -= montantNumerique;
        expeditor.dateMiseAJour = Date.now();
        await expeditor.save({ session });

        // Créditer le destinataire
        destinataire.solde.SRT = (destinataire.solde.SRT || 0) + montantNumerique;
        destinataire.dateMiseAJour = Date.now();
        await destinataire.save({ session });

        await session.commitTransaction();
        session.endSession();

        // --- SIMULATION DU CASH-OUT AUTOMATIQUE POUR LE DESTINATAIRE ---
        // Cette partie est purement une simulation pour l'MVP avec TestAnchor.
        // En PRODUCTION avec une vraie anchor, l'anchor elle-même détecterait le transfert
        // vers le destinataire et déclencherait le paiement Mobile Money.
        try {
            // Logique de conversion SRT -> GHS (simulée)
            const tauxConversionSRTVersGHS = 0.5; // Exemple: 1 SRT = 0.5 GHS
            const montantGHS = montantNumerique * tauxConversionSRTVersGHS;

            console.log(`SIMULATION CASH-OUT: Utilisateur ${destinataire.firstName} ${destinataire.lastName} (Ghana) a reçu ${montantNumerique} ${TEST_ANCHOR_ASSET_CODE}. Simule envoi de ${montantGHS} GHS à son Mobile Money.`);
            
            // Déduire le SRT car il est censé être retiré
            destinataire.solde.SRT -= montantNumerique; 
            // Créditer le solde GHS (simulé)
            destinataire.solde.GHS = (destinataire.solde.GHS || 0) + montantGHS; 
            await destinataire.save(); // Sauvegarder cette mise à jour simulée

            res.status(200).json({
                message: `Transaction ${TEST_ANCHOR_ASSET_CODE} effectuée avec succès ! Montant ${montantGHS} GHS simulé et envoyé au Mobile Money du destinataire.`,
                transactionId: transactionResponse.id,
                expeditorSoldeSRT: expeditor.solde.SRT,
                destinataireSoldeSRTInterneApresCashOut: destinataire.solde.SRT, // Devrait être réduit
                destinataireSoldeGHSsimule: destinataire.solde.GHS
            });

        } catch (simError) {
            console.error("Erreur lors de la simulation de cash-out automatique :", simError);
            // La transaction Stellar a réussi, mais la simulation du cash-out a échoué.
            // La réponse est déjà envoyée, donc juste logguer.
        }


    } catch (erreur) {
        await session.abortTransaction();
        session.endSession();
        console.error("Erreur lors de l'exécution de la transaction Stellar :", erreur.response ? error.response.data : error.message);
        let errorMessage = "Erreur interne du serveur lors de la transaction.";

        if (erreur.response && erreur.response.data && erreur.response.data.extras) {
            errorMessage = `Erreur Stellar: ${erreur.response.data.extras.result_codes.operations || error.response.data.extras.result_codes.transaction}`;
        } else if (error.response && error.response.data) {
             errorMessage = error.response.data.error || JSON.stringify(error.response.data);
        } else if (erreur.message) {
            errorMessage = erreur.message;
        }

        res.status(500).json({ message: errorMessage });
    }
};
