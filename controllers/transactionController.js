// controllers/transactionController.js
const jwt = require("jsonwebtoken"); 
const StellarSdk = require("@stellar/stellar-sdk");
// CORRECTIF CRITIQUE : Server n'est pas directement déstructurable de StellarSdk.
// Il doit être accédé via StellarSdk.Horizon.Server.
const { Keypair, TransactionBuilder, Operation, Asset, Networks } = StellarSdk;
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
  process.exit(1);
}
const TEST_ANCHOR_ASSET_CODE = process.env.TEST_ANCHOR_ASSET_CODE; // "SRT"
const TEST_ANCHOR_ASSET_ISSUER = process.env.TEST_ANCHOR_ASSET_ISSUER; // Émetteur de SRT
const TEST_ANCHOR_SRT_ASSET = new Asset(TEST_ANCHOR_ASSET_CODE, TEST_ANCHOR_ASSET_ISSUER);

const TEST_ANCHOR_AUTH_ENDPOINT = process.env.TEST_ANCHOR_AUTH_ENDPOINT;
const TEST_ANCHOR_TRANSFER_SERVER_SEP6 = process.env.TEST_ANCHOR_TRANSFER_SERVER_SEP6;

// --- Cache pour le token SEP-0010 ---
let sep10AuthToken = null;
let sep10TokenExpiry = 0;

async function getSep10AuthToken() {
    if (sep10AuthToken && sep10TokenExpiry > Date.now() + 60 * 1000) {
        return sep10AuthToken;
    }

    try {
        const challengeResponse = await axios.get(`${TEST_ANCHOR_AUTH_ENDPOINT}?account=${AFRISWIFT_BACKEND_KEYPAIR.publicKey()}`);
        const challengeXDR = challengeResponse.data.transaction;

        const transaction = TransactionBuilder.fromXDR(challengeXDR, STELLAR_NETWORK_PASSPHRASE);
        transaction.sign(AFRISWIFT_BACKEND_KEYPAIR);

        const submitResponse = await axios.post(TEST_ANCHOR_AUTH_ENDPOINT, new URLSearchParams({
            transaction: transaction.toXDR()
        }).toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        sep10AuthToken = submitResponse.data.token;
        const decodedToken = jwt.decode(sep10AuthToken);
        if (decodedToken && decodedToken.exp) {
            sep10TokenExpiry = decodedToken.exp * 1000;
        } else {
            sep10TokenExpiry = Date.now() + (24 * 60 * 60 * 1000);
        }

        console.log("Token SEP-0010 obtenu avec succès !");
        return sep10AuthToken;

    } catch (error) {
        console.error("Erreur lors de l'authentification SEP-0010 avec TestAnchor :", error.response ? error.response.data : error.message);
        throw new Error("Impossible d'authentifier le backend AfriSwift auprès de TestAnchor.");
    }
}

// --- Contrôleur : Enregistrer les informations bancaires de l'utilisateur ---
exports.enregistrerInfosBancaires = async (req, res) => {
    try {
        const userId = req.utilisateur.id;
        const {
            bankAccountNumber,
            bankAccountType,
            bankName,
            bankBranch,
            bankClearingCode
        } = req.body;

        if (!bankAccountNumber || !bankAccountType || !bankName) {
            return res.status(400).json({ message: "Les champs numéro de compte, type de compte et nom de la banque sont requis." });
        }

        const utilisateur = await User.findById(userId);
        if (!utilisateur) {
            return res.status(404).json({ message: "Utilisateur non trouvé." });
        }

        utilisateur.bankDetails = {
            bankAccountNumber,
            bankAccountType,
            bankName,
            bankBranch: bankBranch || null,
            bankClearingCode: bankClearingCode || null
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


// --- Fonction : Dépôt Bancaire (simulé) vers SRT (via TestAnchor) ---
exports.depotBancaireVersStellar = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { montantXOF } = req.body;
        const userId = req.utilisateur.id;

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

        if (!utilisateur.bankDetails || !utilisateur.bankDetails.bankAccountNumber || !utilisateur.bankDetails.bankAccountType || !utilisateur.bankDetails.bankName) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Veuillez d'abord enregistrer toutes vos informations bancaires (numéro, type, nom de la banque) pour effectuer un dépôt." });
        }

        const montantXOFNumerique = parseFloat(montantXOF);
        if (isNaN(montantXOFNumerique) || montantXOFNumerique <= 0) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Montant de dépôt invalide." });
        }

        // --- SIMULATION de la conversion XOF -> SRT ---
        const tauxDeConversionXOFVersSRT = 0.1; 
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

        // 2. Appeler l'API /deposit de TestAnchor (SEP-0006) pour SRT
        const depositResponse = await axios.get(`${TEST_ANCHOR_TRANSFER_SERVER_SEP6}/deposit`, {
            headers: {
                'Authorization': `Bearer ${sep10Token}`
            },
            params: {
                asset_code: TEST_ANCHOR_ASSET_CODE, 
                account: utilisateur.compteStellar.clePublique,
                type: "bank_account",
                bank_account_number: utilisateur.bankDetails.bankAccountNumber,
                bank_account_type: utilisateur.bankDetails.bankAccountType,
                bank_name: utilisateur.bankDetails.bankName,
                bank_branch: utilisateur.bankDetails.bankBranch || "",
                bank_clearing_code: utilisateur.bankDetails.bankClearingCode || "",
                first_name: utilisateur.firstName,
                last_name: utilisateur.lastName,
                email_address: utilisateur.email
            }
        });

        // 3. Mettre à jour le solde interne de l'utilisateur dans la DB (en SRT)
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
        console.error("Erreur lors du dépôt bancaire vers Stellar (SRT) :", error.response ? error.response.data : error.message);
        let errorMessage = "Erreur lors du traitement du dépôt.";
        if (error.response && error.response.data) {
            errorMessage = error.response.data.error || JSON.stringify(error.response.data);
        }
        res.status(500).json({ message: errorMessage });
    }
};

// --- Contrôleur : Effectuer une transaction XLM (P2P) ---
// MODIFIÉ : Prend le montant en XOF, le convertit en XLM, et envoie le XLM.
exports.effectuerTransactionStellar = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { destinataireNumeroCompte, montantXOF } = req.body; // MODIFIÉ : Attendre 'montantXOF'
        const expeditorId = req.utilisateur.id;

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

        const montantXOFNumerique = parseFloat(montantXOF); // MODIFIÉ : Convertir montantXOF
        if (isNaN(montantXOFNumerique) || montantXOFNumerique <= 0) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Montant de transaction invalide." });
        }

        // --- NOUVEAU : Conversion XOF en XLM ---
        const tauxConversionXOFVersXLM = 0.0001; // Exemple: 10000 XOF = 1 XLM
        const montantXLM = montantXOFNumerique * tauxConversionXOFVersXLM;
        if (montantXLM <= 0) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Le montant converti en XLM est trop faible pour la transaction." });
        }

        // --- Vérifier le solde XLM interne de l'expéditeur ---
        if (expeditor.solde.XLM < montantXLM) { // MODIFIÉ : Vérifier avec montantXLM
            await session.abortTransaction();
            return res.status(400).json({ message: `Solde interne XLM insuffisant. Solde actuel: ${expeditor.solde.XLM} XLM. Vous avez besoin de ${montantXLM} XLM.` });
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

        // --- Vérifier que l'expéditeur a assez de XLM (on-chain) ---
        const expeditorXLMBalance = expeditorStellarAccount.balances.find(
            b => b.asset_type === 'native'
        );
        const currentXLMStellarBalance = parseFloat(expeditorXLMBalance ? expeditorXLMBalance.balance : 0);

        const reserveMinimum = 1; 
        const estimatedFee = parseFloat(await STELLAR_SERVER.fetchBaseFee()) / 10000000; 
        
        if (currentXLMStellarBalance < (montantXLM + estimatedFee + reserveMinimum)) { // MODIFIÉ : Vérifier avec montantXLM
            await session.abortTransaction();
            return res.status(400).json({ message: `Solde XLM insuffisant sur votre compte Stellar pour la transaction et les frais de réserve. Solde actuel: ${currentXLMStellarBalance} XLM.` });
        }


        // 5. Construire et signer la transaction Stellar
        const baseFee = await STELLAR_SERVER.fetchBaseFee();
        const transaction = new TransactionBuilder(expeditorStellarAccount, {
            fee: baseFee,
            networkPassphrase: STELLAR_NETWORK_PASSPHRASE
        })
        .addOperation(
            Operation.payment({
                destination: destinataire.compteStellar.clePublique,
                asset: Asset.native(), // Utilise l'actif natif (XLM)
                amount: montantXLM.toString() // MODIFIÉ : Utilise le montant converti en XLM
            })
        )
        .setTimeout(30)
        .build();

        transaction.sign(expeditorKeyPair);

        // 6. Soumettre la transaction au réseau Stellar
        const transactionResponse = await STELLAR_SERVER.submitTransaction(transaction);
        console.log("Stellar P2P XLM Transaction Response:", transactionResponse);

        // 7. Mettre à jour les soldes internes des utilisateurs dans la base de données
        expeditor.solde.XLM -= montantXLM; // MODIFIÉ : Débiter en XLM
        expeditor.dateMiseAJour = Date.now();
        await expeditor.save({ session });

        destinataire.solde.XLM = (destinataire.solde.XLM || 0) + montantXLM; // MODIFIÉ : Créditer en XLM
        destinataire.dateMiseAJour = Date.now();
        await destinataire.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            message: `Transaction de ${montantXOFNumerique} XOF (${montantXLM} XLM) effectuée avec succès !`, // Message mis à jour
            transactionId: transactionResponse.id,
            montantEnvoyeXOF: montantXOFNumerique, // NOUVEAU : Montant initial en XOF
            montantConvertiXLM: montantXLM, // NOUVEAU : Montant converti en XLM
            expeditorSoldeXLM: expeditor.solde.XLM, 
            destinataireSoldeXLMInterne: destinataire.solde.XLM 
        });


    } catch (erreur) {
        await session.abortTransaction();
        session.endSession();
        console.error("Erreur lors de l'exécution de la transaction Stellar :", erreur.response ? erreur.response.data : erreur.message);
        let errorMessage = "Erreur interne du serveur lors de la transaction.";

        if (erreur.response && erreur.response.data && erreur.response.data.extras) {
            errorMessage = `Erreur Stellar: ${erreur.response.data.extras.result_codes.operations || erreur.response.data.extras.result_codes.transaction}`;
        } else if (erreur.response && erreur.response.data) {
             errorMessage = error.response.data.error || JSON.stringify(error.response.data);
        } else if (error.message) {
            errorMessage = erreur.message;
        }

        res.status(500).json({ message: errorMessage });
    }
};


// --- Contrôleur : Retrait Stellar (XLM) vers Bancaire (Cash-Out) en FCFA ---
exports.retraitStellarVersBancaire = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { montantXOF } = req.body; 
        const userId = req.utilisateur.id;

        const utilisateur = await User.findById(userId).select('+compteStellar.cleSecrete').session(session);
        if (!utilisateur) {
            await session.abortTransaction();
            return res.status(404).json({ message: "Utilisateur non trouvé." });
        }
        if (utilisateur.kyc.etat !== "approuvé") {
            await session.abortTransaction();
            return res.status(403).json({ message: "Votre compte n'est pas vérifié (KYC non approuvé). Impossible d'effectuer un retrait." });
        }
        if (utilisateur.statusCompte !== "actif") {
            await session.abortTransaction();
            return res.status(403).json({ message: "Votre compte est bloqué. Impossible d'effectuer un retrait." });
        }

        if (!utilisateur.bankDetails || !utilisateur.bankDetails.bankAccountNumber || !utilisateur.bankDetails.bankAccountType || !utilisateur.bankDetails.bankName) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Veuillez d'abord enregistrer toutes vos informations bancaires (numéro, type, nom de la banque) pour effectuer un retrait." });
        }

        const montantXOFNumerique = parseFloat(montantXOF);
        if (isNaN(montantXOFNumerique) || montantXOFNumerique <= 0) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Montant de retrait invalide." });
        }

        // --- SIMULATION de la conversion XLM -> XOF ---
        const tauxConversionXLMVersXOF = 10000; // Exemple: 1 XLM = 10000 XOF
        const montantXLM = montantXOFNumerique / tauxConversionXLMVersXOF; 

        // 1. Vérifier le solde XLM interne de l'utilisateur
        if (utilisateur.solde.XLM < montantXLM) { 
            await session.abortTransaction();
            return res.status(400).json({ message: `Solde interne XLM insuffisant pour retirer ${montantXOFNumerique} XOF. Solde actuel: ${utilisateur.solde.XLM} XLM. Vous avez besoin de ${montantXLM} XLM.` });
        }

        const userKeyPair = Keypair.fromSecret(utilisateur.compteStellar.cleSecrete);
        let userStellarAccount;
        try {
            userStellarAccount = await STELLAR_SERVER.loadAccount(userKeyPair.publicKey());
        } catch (error) {
            await session.abortTransaction();
            console.error("Erreur de chargement du compte Stellar de l'utilisateur pour le retrait :", error);
            return res.status(500).json({ message: "Impossible de charger votre compte Stellar. Assurez-vous qu'il est activé et a un solde minimum de XLM." });
        }

        // 2. Vérifier le solde XLM on-chain de l'utilisateur
        const userXLMBalance = userStellarAccount.balances.find(
            b => b.asset_type === 'native'
        );
        const currentXLMStellarBalance = parseFloat(userXLMBalance ? userXLMBalance.balance : 0);

        const reserveMinimum = 1; 
        const estimatedFee = parseFloat(await STELLAR_SERVER.fetchBaseFee()) / 10000000; 

        if (currentXLMStellarBalance < (montantXLM + estimatedFee + reserveMinimum)) { 
            await session.abortTransaction();
            return res.status(400).json({ message: `Solde XLM insuffisant sur votre compte Stellar pour le retrait et les frais de réserve. Solde actuel: ${currentXLMStellarBalance} XLM. Vous avez besoin de ${montantXLM} XLM.` });
        }
        
        // 3. Construire et signer la transaction Stellar pour envoyer les XLM à l'ancre (simulé)
        const baseFee = await STELLAR_SERVER.fetchBaseFee();
        const transaction = new TransactionBuilder(userStellarAccount, {
            fee: baseFee,
            networkPassphrase: STELLAR_NETWORK_PASSPHRASE
        })
        .addOperation(
            Operation.payment({
                destination: TEST_ANCHOR_ASSET_ISSUER, // L'émetteur SRT est utilisé comme compte de "burner" pour les tests
                asset: Asset.native(), // Utilise l'actif natif (XLM)
                amount: montantXLM.toString() 
            })
        )
        .setTimeout(30)
        .build();

        transaction.sign(userKeyPair);

        let transactionResponse = null;
        try {
            transactionResponse = await STELLAR_SERVER.submitTransaction(transaction);
            console.log("Stellar XLM Withdrawal Transaction Response (on-chain):", transactionResponse); 
        } catch (stellarError) {
            console.error("Erreur lors de la soumission de la transaction Stellar (retrait XLM, on-chain) :", stellarError.response ? stellarError.response.data : stellarError.message);
        }

        // 4. Déduire le solde interne de l'utilisateur (en XLM)
        utilisateur.solde.XLM -= montantXLM;
        utilisateur.dateMiseAJour = Date.now();
        await utilisateur.save({ session });

        await session.commitTransaction();
        session.endSession();

        // Créditer le solde XOF (simulé)
        utilisateur.solde.XOF = (utilisateur.solde.XOF || 0) + montantXOFNumerique; 
        await utilisateur.save(); 

        res.status(200).json({
            message: `Retrait de ${montantXOFNumerique} XOF initié avec succès (simulation complète). Cela correspond à ${montantXLM} XLM retirés de votre compte Stellar.`,
            transactionId: transactionResponse ? transactionResponse.id : "SIMULATED_ON_CHAIN_FAILURE", 
            montantRetireXOF: montantXOFNumerique, 
            montantXLMConverti: montantXLM, 
            nouveauSoldeXLMInterne: utilisateur.solde.XLM,
            nouveauSoldeXOFInterneSimule: utilisateur.solde.XOF,
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Erreur lors du retrait Stellar vers bancaire :", error.response ? error.response.data : error.message);
        let errorMessage = "Erreur interne du serveur lors du retrait (simulation complète).";

        if (error.response && error.response.data && error.response.data.extras) { 
            errorMessage = `Erreur Stellar (simulation complète): ${error.response.data.extras.result_codes.operations || error.response.data.extras.result_codes.transaction}`;
        } else if (error.response && error.response.data) {
             errorMessage = error.response.data.error || JSON.stringify(error.response.data);
        } else if (error.message) {
            errorMessage = error.message;
        }

        res.status(500).json({ message: errorMessage });
    }
};
