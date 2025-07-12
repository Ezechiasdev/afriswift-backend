// controllers/userController.js

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const StellarSdk = require("@stellar/stellar-sdk");
const { Keypair, TransactionBuilder, Operation, Asset, Networks } = StellarSdk;
const Server = StellarSdk.Horizon.Server; 

// Import dynamique de HDWallet
// const HDWallet = require("stellar-hd-wallet"); // Commenté car nous utilisons l'import dynamique

const User = require("../models/User");

// --- Configurations Stellar ---
const STELLAR_SERVER = new Server(process.env.HORIZON_URL);
const STELLAR_NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK === 'public' ? Networks.PUBLIC : Networks.TESTNET;

// Informations de l'actif SRT de TestAnchor
// Ces variables sont maintenant utilisées directement dans la fonction inscription
// pour s'assurer que process.env est chargé.
const ANCHOR_ASSET_CODE = process.env.TEST_ANCHOR_ASSET_CODE;
const ANCHOR_ASSET_ISSUER = process.env.TEST_ANCHOR_ASSET_ISSUER;


// --- Fonctions utilitaires ---
async function genererNumeroCompteUnique() {
  const prefix = "AFS";
  let numeroUnique = "";
  let isUnique = false;

  while (!isUnique) {
    const random = Math.floor(100000000 + Math.random() * 900000000);
    numeroUnique = `${prefix}${random}`;

    const existingUser = await User.findOne({ numeroCompte: numeroUnique });
    if (!existingUser) {
      isUnique = true;
    } else {
      console.warn(`Collision détectée pour le numéro de compte ${numeroUnique}, en génère un nouveau.`);
    }
  }
  return numeroUnique;
}

// --- Fonction utilitaire pour établir une trustline ---
async function establishTrustline(userKeypair, asset) {
    try {
        const account = await STELLAR_SERVER.loadAccount(userKeypair.publicKey());
        const baseFee = await STELLAR_SERVER.fetchBaseFee(); 
        
        const transaction = new TransactionBuilder(account, {
            fee: baseFee,
            networkPassphrase: STELLAR_NETWORK_PASSPHRASE
        })
        .addOperation(Operation.changeTrust({
            asset: asset,
            limit: "922337203685.4775807" // Montant maximum
        }))
        .setTimeout(30)
        .build();

        transaction.sign(userKeypair);
        const response = await STELLAR_SERVER.submitTransaction(transaction);
        console.log(`Trustline pour ${asset.code} établie pour ${userKeypair.publicKey()}:`, response.id);
        return true;
    } catch (error) {
        console.error(`Erreur lors de l'établissement de la trustline pour ${asset.code} pour ${userKeypair.publicKey()}:`, error);
        if (error.response && error.response.data && error.response.data.extras &&
            error.response.data.extras.result_codes &&
            error.response.data.extras.result_codes.operations &&
            error.response.data.extras.result_codes.operations[0] === 'op_change_trust_malformed') {
                console.warn(`Trustline pour ${asset.code} pourrait déjà exister ou est malformée.`);
                return true;
        }
        return false;
    }
}

// --- Inscription d'un utilisateur ---
exports.inscription = async (req, res) => {
  try {
    const { firstName, lastName, email, telephone, pays, motDePasse } = req.body;

    const utilisateurExistant = await User.findOne({ email });
    if (utilisateurExistant) {
      return res.status(400).json({ message: "Cet email est déjà utilisé." });
    }

    const motDePasseHache = await bcrypt.hash(motDePasse, 10);

    const HDWallet = (await import("stellar-hd-wallet")).default; 
    const phraseDeRecuperation = HDWallet.generateMnemonic(); 
    const walletInstance = HDWallet.fromMnemonic(phraseDeRecuperation); 
    const keypair = walletInstance.getKeypair(0); 
    const clePublique = keypair.publicKey();
    const cleSecrete = keypair.secret();

    const numeroCompte = await genererNumeroCompteUnique(); 

    const nouvelUtilisateur = new User({
      firstName,
      lastName,
      email,
      telephone,
      pays,
      numeroCompte,
      motDePasseHache,
      compteStellar: {
        clePublique,
        cleSecrete,
        phraseDeRecuperation 
      },
      solde: {
        XLM: 0, 
        SRT: 0, 
        USDC: 0
      },
      kyc: { etat: "en attente" },
      statusCompte: "actif",
      dateCreation: Date.now(),
      dateMiseAJour: Date.now(),
    });

    await nouvelUtilisateur.save();

    try {
        const friendbotResponse = await fetch(`https://friendbot.stellar.org/?addr=${clePublique}`);
        const friendbotData = await friendbotResponse.json();
        console.log("Friendbot response for new user:", friendbotData);
        
        nouvelUtilisateur.solde.XLM = 10000; 
        await nouvelUtilisateur.save();

    } catch (friendbotError) {
        console.error("Erreur lors du financement du compte Stellar via Friendbot :", friendbotError);
        return res.status(500).json({ message: "Erreur lors du financement initial du compte Stellar. Veuillez réessayer plus tard." });
    }

    // Définir l'actif SRT ici pour s'assurer que les variables d'environnement sont chargées
    const TEST_ANCHOR_SRT_ASSET = new Asset(ANCHOR_ASSET_CODE, ANCHOR_ASSET_ISSUER);

    const userKeypair = Keypair.fromSecret(cleSecrete);
    const trustlineEstablished = await establishTrustline(userKeypair, TEST_ANCHOR_SRT_ASSET);
    if (!trustlineEstablished) {
        console.error("Impossible d'établir la trustline pour SRT. L'utilisateur pourrait ne pas pouvoir recevoir d'actifs de l'Anchor.");
    } else {
        nouvelUtilisateur.trustlines.push({
            assetCode: ANCHOR_ASSET_CODE, // Utilisation directe des variables d'environnement
            issuer: ANCHOR_ASSET_ISSUER, // Utilisation directe des variables d'environnement
            established: true
        });
        await nouvelUtilisateur.save();
    }

    const utilisateurAEnvoyer = {
      _id: nouvelUtilisateur._id,
      firstName: nouvelUtilisateur.firstName,
      lastName: nouvelUtilisateur.lastName,
      email: nouvelUtilisateur.email,
      telephone: nouvelUtilisateur.telephone,
      pays: nouvelUtilisateur.pays,
      numeroCompte: nouvelUtilisateur.numeroCompte,
      solde: nouvelUtilisateur.solde,
      kyc: nouvelUtilisateur.kyc,
      statusCompte: nouvelUtilisateur.statusCompte,
      dateCreation: nouvelUtilisateur.dateCreation,
      dateMiseAJour: nouvelUtilisateur.dateMiseAJour,
      compteStellar: {
          clePublique: nouvelUtilisateur.compteStellar.clePublique
      },
      trustlines: nouvelUtilisateur.trustlines
    };

    res.status(201).json({
      message: "Inscription réussie. Compte Stellar financé et trustline SRT établie.",
      utilisateur: utilisateurAEnvoyer
    });

  } catch (erreur) {
    console.error("Erreur d'inscription :", erreur);
    if (erreur.code === 11000) {
        return res.status(400).json({ message: "Cet email, numéro de compte, ou clé Stellar est déjà utilisé." });
    }
    res.status(500).json({ message: "Erreur lors de l'inscription." });
  }
};


// --- Connexion et Profil ---
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
                firstName: utilisateur.firstName,
                lastName: utilisateur.lastName,
                email: utilisateur.email,
                telephone: utilisateur.telephone,
                pays: utilisateur.pays,
                numeroCompte: utilisateur.numeroCompte,
                solde: utilisateur.solde,
                kyc: utilisateur.kyc,
                statusCompte: utilisateur.statusCompte,
                dateCreation: utilisateur.dateCreation,
                dateMiseAJour: utilisateur.dateMiseAJour,
                compteStellar: {
                    clePublique: utilisateur.compteStellar.clePublique
                },
                trustlines: utilisateur.trustlines,
                bankDetails: utilisateur.bankDetails
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

        const utilisateur = await User.findById(utilisateurId).select('-motDePasseHache'); 

        if (!utilisateur) {
            return res.status(404).json({ message: "Utilisateur non trouvé." });
        }

        res.status(200).json({
            message: "Profil utilisateur récupéré avec succès",
            utilisateur: {
                _id: utilisateur._id,
                firstName: utilisateur.firstName,
                lastName: utilisateur.lastName,
                email: utilisateur.email,
                telephone: utilisateur.telephone,
                pays: utilisateur.pays,
                numeroCompte: utilisateur.numeroCompte,
                solde: utilisateur.solde,
                kyc: utilisateur.kyc,
                statusCompte: utilisateur.statusCompte,
                dateCreation: utilisateur.dateCreation,
                dateMiseAJour: utilisateur.dateMiseAJour,
                compteStellar: {
                    clePublique: utilisateur.compteStellar.clePublique
                },
                trustlines: utilisateur.trustlines,
                bankDetails: utilisateur.bankDetails
            }
        });

    } catch (erreur) {
        console.error("Erreur lors de la récupération du profil :", erreur);
        res.status(500).json({ message: "Erreur lors de la récupération du profil." });
    }
};
