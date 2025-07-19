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
  console.error("ERROR: AfriSwift backend Stellar secret key (AFRISWIFT_BACKEND_STELLAR_SECRET) is not configured in .env");
  process.exit(1);
}

// TestAnchor SRT asset information
const TEST_ANCHOR_ASSET_CODE = process.env.TEST_ANCHOR_ASSET_CODE || "SRT"; 
const TEST_ANCHOR_ASSET_ISSUER = process.env.TEST_ANCHOR_ASSET_ISSUER || "GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B"; 
const TEST_ANCHOR_SRT_ASSET = new Asset(TEST_ANCHOR_ASSET_CODE, TEST_ANCHOR_ASSET_ISSUER);

// Clé publique du compte de distribution de l'ancre (où les utilisateurs envoient les fonds pour le retrait)
const TEST_ANCHOR_DISTRIBUTION_ACCOUNT = TEST_ANCHOR_ASSET_ISSUER; 


const TEST_ANCHOR_AUTH_ENDPOINT = process.env.TEST_ANCHOR_AUTH_ENDPOINT;
const TEST_ANCHOR_TRANSFER_SERVER_SEP6 = process.env.TEST_ANCHOR_TRANSFER_SERVER_SEP6; 

// --- SEP-0010 Token Cache ---
let sep10AuthToken = null;
let sep10TokenExpiry = 0;

async function getSep10AuthToken() {
    if (sep10AuthToken && sep10TokenExpiry > Date.now() + 60 * 1000) {
        return sep10AuthToken;
    }

    try {
        console.log(`Attempting SEP-10 authentication with TestAnchor at ${TEST_ANCHOR_AUTH_ENDPOINT}`);
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

        console.log("SEP-0010 Token obtained successfully!");
        return sep10AuthToken;

    } catch (error) {
        console.error("Error during SEP-0010 authentication with TestAnchor:", error.response ? error.response.data : error.message);
        throw new Error("Failed to authenticate AfriSwift backend with TestAnchor.");
    }
}

// --- Controller: Register User Bank Information ---
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
            return res.status(400).json({ message: "Bank account number, account type, and bank name are required." });
        }

        const utilisateur = await User.findById(userId);
        if (!utilisateur) {
            return res.status(404).json({ message: "User not found." });
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
            message: "Bank information saved successfully.",
            bankDetails: utilisateur.bankDetails
        });

    } catch (error) {
        console.error("Error saving bank information:", error);
        res.status(500).json({ message: "Internal server error while saving bank information." });
    }
};


// --- Function: Simulated Bank Deposit to SRT (TestAnchor) ---
exports.depotBancaireVersStellar = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { montantXOF } = req.body; 
        const userId = req.utilisateur.id;

        const utilisateur = await User.findById(userId).session(session);
        if (!utilisateur) {
            await session.abortTransaction();
            return res.status(404).json({ message: "User not found." });
        }
        if (utilisateur.kyc.etat !== "approuvé") {
            await session.abortTransaction();
            return res.status(403).json({ message: "Your account is not verified (KYC not approved). Unable to make a deposit." });
        }
        if (utilisateur.statusCompte !== "actif") {
            await session.abortTransaction();
            return res.status(403).json({ message: "Your account is blocked. Unable to make a deposit." });
        }

        if (!utilisateur.bankDetails || !utilisateur.bankDetails.bankAccountNumber || !utilisateur.bankDetails.bankAccountType || !utilisateur.bankDetails.bankName) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Please first register all your bank information (number, type, bank name) to make a deposit." });
        }

        const montantXOFNumerique = parseFloat(montantXOF);
        if (isNaN(montantXOFNumerique) || montantXOFNumerique <= 0) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Invalid deposit amount." });
        }

        const tauxDeConversionXOFVersSRT = 0.1; 
        const montantSRT = montantXOFNumerique * tauxDeConversionXOFVersSRT;

        const hasSRTTrustline = utilisateur.trustlines.some(tl =>
            tl.assetCode === TEST_ANCHOR_ASSET_CODE && 
            tl.issuer === TEST_ANCHOR_ASSET_ISSUER && 
            tl.established
        );
        if (!hasSRTTrustline) {
            await session.abortTransaction();
            return res.status(400).json({ message: `Please first establish a trustline for the asset ${TEST_ANCHOR_ASSET_CODE} (TestAnchor) on your Stellar account. Contact support.` });
        }

        const sep10Token = await getSep10AuthToken();

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

        utilisateur.solde.SRT = (utilisateur.solde.SRT || 0) + montantSRT;
        utilisateur.dateMiseAJour = Date.now();
        await utilisateur.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            message: `Simulated bank deposit. ${montantSRT} ${TEST_ANCHOR_ASSET_CODE} will be credited to your Stellar account by TestAnchor.`,
            montantDeclareXOF: montantXOFNumerique,
            montantEstimeSRT: montantSRT, 
            nouveauSoldeSRTInterne: utilisateur.solde.SRT, 
            stellarDepositDetails: depositResponse.data
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Error during bank deposit to Stellar:", error.response ? error.response.data : error.message);
        let errorMessage = "Error processing deposit.";
        if (error.response && error.response.data) {
            errorMessage = error.response.data.error || JSON.stringify(error.response.data);
        }
        res.status(500).json({ message: errorMessage });
    }
};

// --- Controller: Perform an SRT Transaction (P2P) ---
exports.effectuerTransactionStellar = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { destinataireNumeroCompte, montant } = req.body; 
        const expeditorId = req.utilisateur.id;

        const expeditor = await User.findById(expeditorId).select('+compteStellar.cleSecrete').session(session);
        if (!expeditor) {
            await session.abortTransaction();
            return res.status(404).json({ message: "Sender not found." });
        }
        if (expeditor.kyc.etat !== "approuvé" || expeditor.statusCompte !== "actif") {
            await session.abortTransaction();
            return res.status(403).json({ message: "Sender account not authorized for transactions." });
        }

        const destinataire = await User.findOne({ numeroCompte: destinataireNumeroCompte }).session(session);
        if (!destinataire) {
            await session.abortTransaction();
            return res.status(404).json({ message: "Recipient not found with this AfriSwift account number." });
        }
        if (expeditor._id.toString() === destinataire._id.toString()) {
            await session.abortTransaction();
            return res.status(400).json({ message: "You cannot send money to yourself." });
        }

        const montantNumerique = parseFloat(montant);
        if (isNaN(montantNumerique) || montantNumerique <= 0) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Invalid transaction amount." });
        }

        if (expeditor.solde.SRT < montantNumerique) {
            await session.abortTransaction();
            return res.status(400).json({ message: `Insufficient internal ${TEST_ANCHOR_ASSET_CODE} balance. Current balance: ${expeditor.solde.SRT} ${TEST_ANCHOR_ASSET_CODE}.` });
        }

        const expeditorKeyPair = Keypair.fromSecret(expeditor.compteStellar.cleSecrete);
        let expeditorStellarAccount;
        try {
            expeditorStellarAccount = await STELLAR_SERVER.loadAccount(expeditor.compteStellar.clePublique);
        } catch (error) {
            await session.abortTransaction();
            console.error("Error loading sender's Stellar account:", error);
            return res.status(500).json({ message: "Unable to load sender's Stellar account. Ensure it is activated and has a minimum XLM balance." });
        }

        const expeditorSRTBalance = expeditorStellarAccount.balances.find(
            b => b.asset_code === TEST_ANCHOR_ASSET_CODE && b.asset_issuer === TEST_ANCHOR_ASSET_ISSUER
        );
        const currentSRTStellarBalance = parseFloat(expeditorSRTBalance ? expeditorSRTBalance.balance : 0);

        if (currentSRTStellarBalance < montantNumerique) {
            await session.abortTransaction();
            return res.status(400).json({ message: `Insufficient ${TEST_ANCHOR_ASSET_CODE} balance on your Stellar account. Current balance: ${currentSRTStellarBalance} ${TEST_ANCHOR_ASSET_CODE}.` });
        }

        const baseFee = await STELLAR_SERVER.fetchBaseFee();
        const transaction = new TransactionBuilder(expeditorStellarAccount, {
            fee: baseFee,
            networkPassphrase: STELLAR_NETWORK_PASSPHRASE
        })
        .addOperation(
            Operation.payment({
                destination: destinataire.compteStellar.clePublique,
                asset: TEST_ANCHOR_SRT_ASSET, 
                amount: montantNumerique.toString()
            })
        )
        .setTimeout(30)
        .build();

        transaction.sign(expeditorKeyPair);

        const transactionResponse = await STELLAR_SERVER.submitTransaction(transaction);
        console.log("Stellar P2P SRT Transaction Response:", transactionResponse); 

        expeditor.solde.SRT -= montantNumerique;
        expeditor.dateMiseAJour = Date.now();
        await expeditor.save({ session });

        destinataire.solde.SRT = (destinataire.solde.SRT || 0) + montantNumerique;
        destinataire.dateMiseAJour = Date.now();
        await destinataire.save({ session });

        await session.commitTransaction();
        session.endSession();

        // --- AUTOMATIC CASH-OUT SIMULATION FOR RECIPIENT ---
        try {
            const tauxConversionSRTVersGHS = 0.5; 
            const montantGHS = montantNumerique * tauxConversionSRTVersGHS;

            console.log(`CASH-OUT SIMULATION: User ${destinataire.firstName} ${destinataire.lastName} (Ghana) received ${montantNumerique} ${TEST_ANCHOR_ASSET_CODE}. Simulating transfer of ${montantGHS} GHS to their Mobile Money.`);
            
            destinataire.solde.SRT -= montantNumerique; 
            destinataire.solde.GHS = (destinataire.solde.GHS || 0) + montantGHS; 
            await destinataire.save(); 

            res.status(200).json({
                message: `Transaction ${TEST_ANCHOR_ASSET_CODE} completed successfully! Amount ${montantGHS} GHS simulated and sent to recipient's Mobile Money.`,
                transactionId: transactionResponse.id,
                expeditorSoldeSRT: expeditor.solde.SRT, 
                destinataireSoldeSRTInterneApresCashOut: destinataire.solde.SRT, 
                destinataireSoldeGHSsimule: destinataire.solde.GHS
            });

        } catch (simError) {
            console.error("Error during automatic cash-out simulation:", simError);
        }


    } catch (erreur) {
        await session.abortTransaction();
        session.endSession();
        console.error("Error executing Stellar transaction:", erreur.response ? erreur.response.data : erreur.message);
        let errorMessage = "Internal server error during transaction.";

        if (erreur.response && erreur.response.data && erreur.response.data.extras) { 
            errorMessage = `Stellar Error: ${erreur.response.data.extras.result_codes.operations || erreur.response.data.extras.result_codes.transaction}`;
        } else if (erreur.response && erreur.response.data) {
             errorMessage = error.response.data.error || JSON.stringify(error.response.data);
        } else if (erreur.message) {
            errorMessage = erreur.message;
        }

        res.status(500).json({ message: errorMessage });
    }
};


// NOUVELLE FONCTION : Retrait Stellar vers Bancaire (Cash-Out) en FCFA
exports.retraitStellarVersBancaire = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { montantXOF } = req.body; // Montant en FCFA à retirer (MODIFIÉ)
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

        // --- CONVERSION FCFA -> SRT (NOUVEAU) ---
        const tauxConversionSRTVersXOF = 10; // 1 SRT = 10 XOF (utilisé pour la simulation de cash-out, donc inversé ici)
        const montantSRT = montantXOFNumerique / tauxConversionSRTVersXOF; // Calcul du montant SRT nécessaire

        // 1. Vérifier le solde SRT interne de l'utilisateur
        if (utilisateur.solde.SRT < montantSRT) { // Vérifie avec le montant SRT calculé
            await session.abortTransaction();
            return res.status(400).json({ message: `Solde interne ${TEST_ANCHOR_ASSET_CODE} insuffisant pour retirer ${montantXOFNumerique} XOF. Solde actuel: ${utilisateur.solde.SRT} ${TEST_ANCHOR_ASSET_CODE}. Vous avez besoin de ${montantSRT} SRT.` });
        }

        // 2. Charger le compte Stellar de l'utilisateur
        const userKeyPair = Keypair.fromSecret(utilisateur.compteStellar.cleSecrete);
        let userStellarAccount;
        try {
            userStellarAccount = await STELLAR_SERVER.loadAccount(userKeyPair.publicKey());
        } catch (error) {
            await session.abortTransaction();
            console.error("Erreur de chargement du compte Stellar de l'utilisateur pour le retrait :", error);
            return res.status(500).json({ message: "Impossible de charger votre compte Stellar. Assurez-vous qu'il est activé et a un solde minimum de XLM." });
        }

        // 3. Vérifier le solde SRT on-chain de l'utilisateur
        const userSRTBalance = userStellarAccount.balances.find(
            b => b.asset_code === TEST_ANCHOR_ASSET_CODE && b.asset_issuer === TEST_ANCHOR_ASSET_ISSUER
        );
        const currentSRTStellarBalance = parseFloat(userSRTBalance ? userSRTBalance.balance : 0);

        if (currentSRTStellarBalance < montantSRT) { // Vérifie avec le montant SRT calculé
            await session.abortTransaction();
            return res.status(400).json({ message: `Solde ${TEST_ANCHOR_ASSET_CODE} insuffisant sur votre compte Stellar pour retirer ${montantXOFNumerique} XOF. Solde actuel: ${currentSRTStellarBalance} ${TEST_ANCHOR_ASSET_CODE}. Vous avez besoin de ${montantSRT} SRT.` });
        }

        // 4. Construire et signer la transaction Stellar pour envoyer les SRT à l'ancre
        const baseFee = await STELLAR_SERVER.fetchBaseFee();
        const transaction = new TransactionBuilder(userStellarAccount, {
            fee: baseFee,
            networkPassphrase: STELLAR_NETWORK_PASSPHRASE
        })
        .addOperation(
            Operation.payment({
                destination: TEST_ANCHOR_DISTRIBUTION_ACCOUNT, 
                asset: TEST_ANCHOR_SRT_ASSET, 
                amount: montantSRT.toString() // Utilise le montant SRT calculé
            })
        )
        .setTimeout(30)
        .build();

        transaction.sign(userKeyPair);

        // 5. Soumettre la transaction au réseau Stellar
        const transactionResponse = await STELLAR_SERVER.submitTransaction(transaction);
        console.log("Stellar SRT Withdrawal Transaction Response:", transactionResponse); 

        // 6. Déduire le solde interne de l'utilisateur (en SRT)
        utilisateur.solde.SRT -= montantSRT;
        utilisateur.dateMiseAJour = Date.now();
        await utilisateur.save({ session });

        // 7. Appeler l'API /withdraw de TestAnchor (SEP-0006)
        const sep10Token = await getSep10AuthToken(); 

        const withdrawResponse = await axios.get(`${TEST_ANCHOR_TRANSFER_SERVER_SEP6}/withdraw`, {
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

        await session.commitTransaction();
        session.endSession();

        // --- SIMULATION DE CONVERSION SRT -> XOF (pour le message de succès) ---
        // Le montant XOF est déjà l'entrée, donc nous l'utilisons directement.
        // La mise à jour du solde XOF interne est déjà faite dans la simulation de cash-out.
        utilisateur.solde.XOF = (utilisateur.solde.XOF || 0) + montantXOFNumerique; // Créditer le solde XOF simulé
        await utilisateur.save(); 

        res.status(200).json({
            message: `Retrait de ${montantXOFNumerique} XOF initié avec succès. Cela correspond à ${montantSRT} ${TEST_ANCHOR_ASSET_CODE} retirés de votre compte Stellar.`,
            transactionId: transactionResponse.id,
            montantRetireXOF: montantXOFNumerique, // Montant FCFA demandé
            montantSRTConverti: montantSRT, // Montant SRT réellement traité
            nouveauSoldeSRTInterne: utilisateur.solde.SRT,
            nouveauSoldeXOFInterneSimule: utilisateur.solde.XOF,
            anchorWithdrawalDetails: withdrawResponse.data
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Erreur lors du retrait Stellar vers bancaire :", error.response ? error.response.data : error.message);
        let errorMessage = "Erreur interne du serveur lors du retrait.";

        if (error.response && error.response.data && error.response.data.extras) { 
            errorMessage = `Erreur Stellar: ${error.response.data.extras.result_codes.operations || error.response.data.extras.result_codes.transaction}`;
        } else if (error.response && error.response.data) {
             errorMessage = error.response.data.error || JSON.stringify(error.response.data);
        } else if (error.message) {
            errorMessage = error.message;
        }

        res.status(500).json({ message: errorMessage });
    }
};

