// fund_srt_account.js

// Importation des modules nécessaires de Stellar SDK
const StellarSdk = require("@stellar/stellar-sdk");
const { Keypair, TransactionBuilder, Operation, Asset, Networks } = StellarSdk;

// --- Configuration Stellar Testnet ---
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const STELLAR_SERVER = new StellarSdk.Horizon.Server(HORIZON_URL);
const STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;

// --- Informations de l'actif SRT de TestAnchor ---
const TEST_ANCHOR_ASSET_CODE = "SRT";
const TEST_ANCHOR_ASSET_ISSUER = "GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B";
const TEST_ANCHOR_SRT_ASSET = new Asset(TEST_ANCHOR_ASSET_CODE, TEST_ANCHOR_ASSET_ISSUER);

// --- Clé secrète de l'émetteur SRT de TestAnchor (PUBLIQUE pour les tests) ---
// C'est le compte qui va "envoyer" les SRT à votre utilisateur.
// Cette clé est publique et utilisée pour les tests sur le Testnet.
// VÉRIFICATION CRITIQUE DE LA CLÉ SECRÈTE
//
// ATTENTION TRÈS IMPORTANTE :
// L'erreur persistante indique que des caractères invisibles sont copiés.
// VEUILLEZ TAPER MANUELLEMENT CETTE CLÉ EXACTEMENT COMME SUIT :
// "SD24B7G23V4662T7O7B22W2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y"
// Assurez-vous qu'il n'y a AUCUN espace, retour à la ligne ou autre caractère avant ou après les guillemets.
const TEST_ANCHOR_ISSUER_SECRET_RAW = "SD24B7G23V4662T7O7B22W2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y2Y"; 
    
let TEST_ANCHOR_ISSUER_KEYPAIR;
try {
    console.log(`Longueur de la clé secrète brute: ${TEST_ANCHOR_ISSUER_SECRET_RAW.length}`);
    // Nous ne faisons plus de nettoyage agressif ici, car le problème semble être
    // l'introduction de caractères non-standards lors du copier-coller.
    // La solution la plus fiable est de taper la clé manuellement.
    const cleanedSecret = TEST_ANCHOR_ISSUER_SECRET_RAW; 
    console.log(`Longueur de la clé secrète finale: ${cleanedSecret.length}`);

    if (cleanedSecret.length !== 56) {
        throw new Error(`La longueur de la clé n'est PAS 56. Longueur actuelle: ${cleanedSecret.length}. Veuillez taper la clé manuellement.`);
    }

    if (!StellarSdk.StrKey.isValidEd25519SecretSeed(cleanedSecret)) {
        throw new Error("La clé secrète de l'émetteur SRT est invalide selon Stellar SDK. Vérifiez les caractères.");
    }
    TEST_ANCHOR_ISSUER_KEYPAIR = Keypair.fromSecret(cleanedSecret);
    console.log("Clé secrète de l'émetteur SRT validée et Keypair créé.");
} catch (e) {
    console.error("ERREUR CRITIQUE: Impossible de créer le Keypair de l'émetteur SRT.");
    console.error("Vérifiez la valeur de TEST_ANCHOR_ISSUER_SECRET_RAW dans fundsrt.js.");
    console.error("Erreur détaillée:", e.message);
    process.exit(1); // Arrête le script si la clé est invalide
}


/**
 * Finance un compte Stellar avec un montant spécifié de SRT sur le Testnet.
 * @param {string} userPublicKey - La clé publique du compte utilisateur à financer.
 * @param {number} amount - Le montant de SRT à envoyer.
 * @returns {Promise<{success: boolean, transactionId?: string, error?: string}>} - Résultat de l'opération.
 */
async function fundSrtAccount(userPublicKey, amount) {
    try {
        console.log(`Tentative de financement du compte ${userPublicKey} avec ${amount} SRT...`);

        // 1. Charger le compte de l'émetteur SRT depuis Horizon
        const issuerAccount = await STELLAR_SERVER.loadAccount(TEST_ANCHOR_ISSUER_KEYPAIR.publicKey());
        console.log(`Compte de l'émetteur chargé. Séquence: ${issuerAccount.sequence}`);

        // 2. Construire la transaction de paiement
        const baseFee = await STELLAR_SERVER.fetchBaseFee(); 
        const transaction = new TransactionBuilder(issuerAccount, {
            fee: baseFee, 
            networkPassphrase: STELLAR_NETWORK_PASSPHRASE 
        })
        .addOperation(
            Operation.payment({
                destination: userPublicKey, 
                asset: TEST_ANCHOR_SRT_ASSET, 
                amount: amount.toString() 
            })
        )
        .setTimeout(30) 
        .build(); 

        // 3. Signer la transaction avec la clé secrète de l'émetteur
        transaction.sign(TEST_ANCHOR_ISSUER_KEYPAIR);

        // 4. Soumettre la transaction au réseau Stellar
        const transactionResponse = await STELLAR_SERVER.submitTransaction(transaction);
        console.log("Transaction de financement SRT soumise avec succès !");
        console.log("ID de la transaction:", transactionResponse.id);
        console.log("Lien Stellar Expert:", `https://stellar.expert/explorer/testnet/tx/${transactionResponse.id}`);
        
        return { success: true, transactionId: transactionResponse.id };

    } catch (error) {
        console.error("Erreur lors du financement du compte SRT :", error.response ? error.response.data : error.message);
        if (error.response && error.response.data && error.response.data.extras) {
            console.error("Codes de résultat Stellar:", error.response.data.extras.result_codes);
        }
        return { success: false, error: error.message };
    }
}

// --- Exemple d'utilisation ---
const userToFundPublicKey = "GCNNJFP5YX67O3YYAQAK5CA3DZ63SAVHF5BPZCQKBOT5M4QFIKV3AEHQ"; // REMPLACEZ CECI
const amountToFund = 1000; 

fundSrtAccount(userToFundPublicKey, amountToFund)
    .then(result => {
        if (result.success) {
            console.log(`Compte ${userToFundPublicKey} financé avec ${amountToFund} SRT.`);
        } else {
            console.error(`Échec du financement du compte ${userToFundPublicKey}.`);
        }
    })
    .catch(err => console.error("Erreur inattendue lors de l'exécution du script:", err));

