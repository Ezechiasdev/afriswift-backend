// controllers/userController.js

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Une Nouvelle petite correction
// Nouveau et CORRECT pour stellar-sdk@13.3.0:
const StellarSdk = require("@stellar/stellar-sdk");
const { Keypair, TransactionBuilder, Operation, Asset, Networks } = StellarSdk;
// Accédez à Server via StellarSdk.Horizon
const Server = StellarSdk.Horizon.Server; // <-- C'est ça la clé !

const User = require("../models/User");

// --- Configurations Stellar ---
const STELLAR_SERVER = new Server(process.env.HORIZON_URL);
const STELLAR_NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK === 'public' ? Networks.PUBLIC : Networks.TESTNET;

// Informations de l'actif SRT de TestAnchor
const TEST_ANCHOR_SRT_ASSET_CODE = process.env.TEST_ANCHOR_ASSET_CODE;
const TEST_ANCHOR_SRT_ASSET_ISSUER = process.env.TEST_ANCHOR_ASSET_ISSUER;
const TEST_ANCHOR_SRT_ASSET = new Asset(TEST_ANCHOR_SRT_ASSET_CODE, TEST_ANCHOR_SRT_ASSET_ISSUER);

// --- Fonctions utilitaires (maintenues) ---
function genererNumeroCompte() {
  const prefix = "AFS";
  const random = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}${random}`;
}

// --- Nouvelle fonction utilitaire pour établir une trustline ---
async function establishTrustline(userKeypair, asset) {
    try {
        const account = await STELLAR_SERVER.loadAccount(userKeypair.publicKey());
        const transaction = new TransactionBuilder(account, {
            fee: STELLAR_SERVER.fetchBaseFee(),
            networkPassphrase: STELLAR_NETWORK_PASSPHRASE
        })
        .addOperation(Operation.changeTrust({
            asset: asset,
            limit: "922337203685.4775807" // Montant maximum (valeur par défaut)
        }))
        .setTimeout(30)
        .build();

        transaction.sign(userKeypair);
        const response = await STELLAR_SERVER.submitTransaction(transaction);
        console.log(`Trustline pour ${asset.code} établie pour ${userKeypair.publicKey()}:`, response.id);
        return true;
    } catch (error) {
        console.error(`Erreur lors de l'établissement de la trustline pour ${asset.code} pour ${userKeypair.publicKey()}:`, error);
        // Gérer les erreurs spécifiques, par exemple, si la trustline existe déjà
        if (error.response && error.response.data && error.response.data.extras &&
            error.response.data.extras.result_codes &&
            error.response.data.extras.result_codes.operations &&
            error.response.data.extras.result_codes.operations[0] === 'op_change_trust_malformed') {
                console.warn(`Trustline pour ${asset.code} pourrait déjà exister ou est malformée.`);
                return true; // Considérer comme succès si déjà existante
        }
        return false;
    }
}

// --- Inscription d'un utilisateur ---
exports.inscription = async (req, res) => {
  try {
    const { nomComplet, email, telephone, pays, motDePasse } = req.body;

    const utilisateurExistant = await User.findOne({ email });
    if (utilisateurExistant) {
      return res.status(400).json({ message: "Cet email est déjà utilisé." });
    }

    const motDePasseHache = await bcrypt.hash(motDePasse, 10);

    const keypair = Keypair.random();
    const clePublique = keypair.publicKey();
    const cleSecrete = keypair.secret();

    const numeroCompte = genererNumeroCompte();

    const nouvelUtilisateur = new User({
      nomComplet,
      email,
      telephone,
      pays,
      numeroCompte,
      motDePasseHache,
      compteStellar: {
        clePublique,
        cleSecrete
      },
      solde: {
        XLM: 0, // Initialisé à 0, sera financé par Friendbot
        SRT: 0, // Initialisé à 0
        USDC: 0 // Si vous utilisez USDC
      },
      kyc: { etat: "en attente" }, // Etat KYC initial
      statusCompte: "actif", // Statut initial du compte
      dateCreation: Date.now(),
      dateMiseAJour: Date.now(),
    });

    // Sauvegarde de l'utilisateur dans la base de données (important avant le Friendbot)
    await nouvelUtilisateur.save();

    // === 1. Financement du compte Stellar via Friendbot (Testnet uniquement) ===
    // Pour activer le compte et lui donner un solde initial de XLM
    try {
        const friendbotResponse = await fetch(`https://friendbot.stellar.org/?addr=${clePublique}`);
        const friendbotData = await friendbotResponse.json();
        console.log("Friendbot response for new user:", friendbotData);
    } catch (friendbotError) {
        console.error("Erreur lors du financement du compte Stellar via Friendbot :", friendbotError);
        // Si Friendbot échoue, le compte Stellar de l'utilisateur n'aura pas de XLM.
        // Cela bloquera les transactions ou les trustlines sans XLM.
        // Vous pourriez vouloir bloquer l'inscription ici ou la marquer comme "en attente de financement".
        return res.status(500).json({ message: "Erreur lors du financement initial du compte Stellar. Veuillez réessayer plus tard." });
    }

    // === 2. Établir la trustline pour l'actif SRT de TestAnchor ===
    // C'est crucial pour que l'utilisateur puisse détenir cet actif
    const userKeypair = Keypair.fromSecret(cleSecrete); // Recréer le Keypair
    const trustlineEstablished = await establishTrustline(userKeypair, TEST_ANCHOR_SRT_ASSET);

    if (!trustlineEstablished) {
        // Gérer le cas où la trustline n'a pas pu être établie
        // Peut-être supprimer l'utilisateur créé ou le marquer comme non-opérationnel
        console.error("Impossible d'établir la trustline pour SRT. L'utilisateur pourrait ne pas pouvoir recevoir d'actifs de l'Anchor.");
        // Pour l'MVP, on continue mais c'est un point d'attention.
    } else {
        // Mettre à jour la base de données pour refléter la trustline établie
        nouvelUtilisateur.trustlines.push({
            assetCode: TEST_ANCHOR_SRT_ASSET_CODE,
            issuer: TEST_ANCHOR_SRT_ASSET_ISSUER,
            established: true
        });
        await nouvelUtilisateur.save(); // Sauvegarder la mise à jour
    }

    // Préparer la réponse (sans la clé secrète)
    const utilisateurAEnvoyer = {
      _id: nouvelUtilisateur._id,
      nomComplet: nouvelUtilisateur.nomComplet,
      email: nouvelUtilisateur.email,
      telephone: nouvelUtilisateur.telephone,
      pays: nouvelUtilisateur.pays,
      numeroCompte: nouvelUtilisateur.numeroCompte,
      solde: nouvelUtilisateur.solde, // Renvoie tous les soldes maintenant
      kyc: nouvelUtilisateur.kyc,
      statusCompte: nouvelUtilisateur.statusCompte,
      dateCreation: nouvelUtilisateur.dateCreation,
      dateMiseAJour: nouvelUtilisateur.dateMiseAJour,
      compteStellar: {
          clePublique: nouvelUtilisateur.compteStellar.clePublique
      },
      trustlines: nouvelUtilisateur.trustlines // Inclure les trustlines pour vérification
    };

    res.status(201).json({
      message: "Inscription réussie. Compte Stellar financé et trustline SRT établie.",
      utilisateur: utilisateurAEnvoyer
    });

  } catch (erreur) {
    console.error("Erreur d'inscription :", erreur);
    if (erreur.code === 11000) {
        return res.status(400).json({ message: "Cet email ou numéro de compte est déjà utilisé." });
    }
    res.status(500).json({ message: "Erreur lors de l'inscription." });
  }
};


// --- Connexion et Profil (ajuster pour renvoyer tous les soldes) ---
exports.connexion = async (req, res) => {
    try {
        const { email, motDePasse } = req.body;

        const utilisateur = await User.findOne({ email }).select('+motDePasseHache +compteStellar.cleSecrete');

        if (!utilisateur) {
            return res.status(400).json({ message: "Identifiants invalides." });
        }

        const estMotDePasseValide = await bcrypt.compare(motDePasse, utilisateur.motDePasseHache);

        if (!estMotDePasseValide) {
            return res.status(400).json({ message: "Identifiants invalides." });
        }

        if (utilisateur.statusCompte === "bloqué") {
            return res.status(403).json({ message: "Votre compte est bloqué. Veuillez contacter le support." });
        }

        const token = jwt.sign(
            {
                id: utilisateur._id,
                email: utilisateur.email,
                numeroCompte: utilisateur.numeroCompte,
                kycEtat: utilisateur.kyc.etat,
                statusCompte: utilisateur.statusCompte
            },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.status(200).json({
            message: "Connexion réussie",
            token,
            utilisateur: {
                _id: utilisateur._id,
                nomComplet: utilisateur.nomComplet,
                email: utilisateur.email,
                telephone: utilisateur.telephone,
                pays: utilisateur.pays,
                numeroCompte: utilisateur.numeroCompte,
                solde: utilisateur.solde, // Renvoyer tous les soldes
                kyc: utilisateur.kyc,
                statusCompte: utilisateur.statusCompte,
                dateCreation: utilisateur.dateCreation,
                dateMiseAJour: utilisateur.dateMiseAJour,
                compteStellar: {
                    clePublique: utilisateur.compteStellar.clePublique
                },
                trustlines: utilisateur.trustlines // Renvoyer les trustlines
            }
        });

    } catch (erreur) {
        console.error("Erreur de connexion :", erreur);
        res.status(500).json({ message: "Erreur lors de la connexion." });
    }
};

exports.getProfil = async (req, res) => {
    try {
        const utilisateurId = req.utilisateur.id;

        const utilisateur = await User.findById(utilisateurId).select('-motDePasseHache -compteStellar.cleSecrete');

        if (!utilisateur) {
            return res.status(404).json({ message: "Utilisateur non trouvé." });
        }

        res.status(200).json({
            message: "Profil utilisateur récupéré avec succès",
            utilisateur: {
                _id: utilisateur._id,
                nomComplet: utilisateur.nomComplet,
                email: utilisateur.email,
                telephone: utilisateur.telephone,
                pays: utilisateur.pays,
                numeroCompte: utilisateur.numeroCompte,
                solde: utilisateur.solde, // Renvoyer tous les soldes
                kyc: utilisateur.kyc,
                statusCompte: utilisateur.statusCompte,
                dateCreation: utilisateur.dateCreation,
                dateMiseAJour: utilisateur.dateMiseAJour,
                compteStellar: {
                    clePublique: utilisateur.compteStellar.clePublique
                },
                trustlines: utilisateur.trustlines // Renvoyer les trustlines
            }
        });

    } catch (erreur) {
        console.error("Erreur lors de la récupération du profil :", erreur);
        res.status(500).json({ message: "Erreur lors de la récupération du profil." });
    }
};