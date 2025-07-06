const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken"); // Ligne ajoutée pour le JWT 
const { Keypair } = require("@stellar/stellar-sdk");
const User = require("../models/User");

// Génère un numéro de compte unique
function genererNumeroCompte() {
  const prefix = "AFS"; // AfriSwift
  const random = Math.floor(100000 + Math.random() * 900000); // 6 chiffres aléatoires
  return `${prefix}${random}`;
}

// Détermine la devise du pays
function getDeviseParPays(pays) {
  const mapping = {
    "Bénin": "XOF",
    "Nigéria": "NGN",
    "Ghana": "GHS",
    "États-Unis": "USD"
  };
  // Ajout d'une gestion plus robuste pour les devises.
  // Note: Si vous avez plus de devises, une base de données ou un fichier de configuration serait mieux.
  return mapping[pays] || "USD"; // USD par défaut
}

// Inscription d'un utilisateur
exports.inscription = async (req, res) => {
  try {
    const { nomComplet, email, telephone, pays, motDePasse } = req.body;

    // Vérifie si l'utilisateur existe déjà
    const utilisateurExistant = await User.findOne({ email });
    if (utilisateurExistant) {
      return res.status(400).json({ message: "Cet email est déjà utilisé." });
    }

    // Hachage du mot de passe
    const motDePasseHache = await bcrypt.hash(motDePasse, 10);

    // Génération des clés Stellar
    const keypair = Keypair.random();
    const clePublique = keypair.publicKey();
    const cleSecrete = keypair.secret();

    // Génération du numéro de compte
    const numeroCompte = genererNumeroCompte();

    // Création d'une nouvelle instance d'utilisateur
    // Mongoose appliquera ici les valeurs par défaut pour 'solde', 'kyc' et 'statusCompte'
    // car nous créons une instance du modèle avant de la sauvegarder.
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
      // Pas besoin d'initialiser solde ici, Mongoose utilisera les defaults
      // Pas besoin d'initialiser kyc ici, Mongoose utilisera les defaults
      // Pas besoin d'initialiser statusCompte ici, Mongoose utilisera les defaults
      // dateCreation et dateMiseAJour seront aussi gérées par default: Date.now
    });

    // Sauvegarde de l'utilisateur dans la base de données
    await nouvelUtilisateur.save();

    // Détermination de la devise du pays
    const deviseUtilisateur = getDeviseParPays(nouvelUtilisateur.pays);
    const soldeDansLaDevise = nouvelUtilisateur.solde[deviseUtilisateur] || 0;

    // Création de l'objet à envoyer au frontend
    const utilisateurAEnvoyer = {
      nomComplet: nouvelUtilisateur.nomComplet,
      email: nouvelUtilisateur.email,
      telephone: nouvelUtilisateur.telephone,
      pays: nouvelUtilisateur.pays,
      numeroCompte: nouvelUtilisateur.numeroCompte,
      devise: deviseUtilisateur,
      solde: soldeDansLaDevise,
      kyc: {
        etat: nouvelUtilisateur.kyc.etat,
        documents: nouvelUtilisateur.kyc.documents,
        dateVerification: nouvelUtilisateur.kyc.dateVerification
      },
      statusCompte: nouvelUtilisateur.statusCompte,
      dateCreation: nouvelUtilisateur.dateCreation, // Inclus pour la cohérence
      dateMiseAJour: nouvelUtilisateur.dateMiseAJour // Inclus pour la cohérence
    };

    res.status(201).json({
      message: "Inscription réussie",
      utilisateur: utilisateurAEnvoyer
    });

  } catch (erreur) {
    console.error("Erreur d'inscription :", erreur);
    // Gérer les erreurs spécifiques, par exemple, si numeroCompte n'est pas unique
    if (erreur.code === 11000) { // Erreur de duplicata MongoDB
        return res.status(400).json({ message: "Le numéro de compte généré est déjà utilisé. Veuillez réessayer." });
    }
    res.status(500).json({ message: "Erreur lors de l'inscription." });
  }
};

// Nouvelle fonction de connexion
exports.connexion = async (req, res) => {
  try {
    const { email, motDePasse } = req.body;

    // 1. Trouver l'utilisateur par email
    // On utilise .select('+motDePasseHache') car nous avons mis select: false dans le schéma.
    const utilisateur = await User.findOne({ email }).select('+motDePasseHache +compteStellar.cleSecrete');

    if (!utilisateur) {
      return res.status(400).json({ message: "Identifiants invalides." });
    }

    // 2. Comparer le mot de passe fourni avec le mot de passe haché
    const estMotDePasseValide = await bcrypt.compare(motDePasse, utilisateur.motDePasseHache);

    if (!estMotDePasseValide) {
      return res.status(400).json({ message: "Identifiants invalides." });
    }

    // 3. Vérifier le statut du compte (optionnel mais recommandé pour la sécurité)
    if (utilisateur.statusCompte === "bloqué") {
      return res.status(403).json({ message: "Votre compte est bloqué. Veuillez contacter le support." });
    }

    // 4. Générer un Token Web JSON (JWT)
    // Le payload du token doit contenir des informations non sensibles mais utiles pour identifier l'utilisateur.
    // NE PAS inclure le motDePasseHache ou la clé secrète Stellar ici !
    const token = jwt.sign(
      {
        id: utilisateur._id,
        email: utilisateur.email,
        numeroCompte: utilisateur.numeroCompte,
        // Vous pouvez ajouter d'autres infos pertinentes mais NON SENSIBLES
        // par exemple, le statut KYC, le pays, etc.
        kycEtat: utilisateur.kyc.etat,
        statusCompte: utilisateur.statusCompte
      },
      process.env.JWT_SECRET, // Utilisez une variable d'environnement pour la clé secrète JWT
      { expiresIn: "1h" } // Le token expire après 1 heure
    );

    // Détermination de la devise du pays
    const deviseUtilisateur = getDeviseParPays(utilisateur.pays);
    const soldeDansLaDevise = utilisateur.solde[deviseUtilisateur] || 0;

    // 5. Renvoyer le token et les informations de l'utilisateur (sans le mot de passe haché)
    res.status(200).json({
      message: "Connexion réussie",
      token, // Le token d'authentification
      utilisateur: {
        _id: utilisateur._id,
        nomComplet: utilisateur.nomComplet,
        email: utilisateur.email,
        telephone: utilisateur.telephone,
        pays: utilisateur.pays,
        numeroCompte: utilisateur.numeroCompte,
        devise: deviseUtilisateur,
        solde: soldeDansLaDevise,
        kyc: {
            etat: utilisateur.kyc.etat,
            documents: utilisateur.kyc.documents,
            dateVerification: utilisateur.kyc.dateVerification
        },
        statusCompte: utilisateur.statusCompte,
        dateCreation: utilisateur.dateCreation,
        dateMiseAJour: utilisateur.dateMiseAJour,
        compteStellar: { // On peut renvoyer la clé publique Stellar si besoin côté client
            clePublique: utilisateur.compteStellar.clePublique
        }
      }
    });

  } catch (erreur) {
    console.error("Erreur de connexion :", erreur);
    res.status(500).json({ message: "Erreur lors de la connexion." });
  }
};

// Nouvelle fonction facultative Ezéchias tu peux le retirer après N'oublie pas tu peux l'enlever après 
// si elle n'est pas nécessaire pour ton application
// Nouvelle fonction pour obtenir le profil de l'utilisateur connecté
exports.getProfil = async (req, res) => {
  try {
    // L'ID de l'utilisateur est disponible via le token décodé, grâce au middleware
    const utilisateurId = req.utilisateur.id;

    // Chercher l'utilisateur dans la base de données (sans le mot de passe haché ou clé secrète)
    const utilisateur = await User.findById(utilisateurId).select('-motDePasseHache -compteStellar.cleSecrete');

    if (!utilisateur) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    // Préparer la réponse (similaire à l'inscription/connexion)
    const deviseUtilisateur = getDeviseParPays(utilisateur.pays);
    const soldeDansLaDevise = utilisateur.solde[deviseUtilisateur] || 0;

    const utilisateurAEnvoyer = {
      _id: utilisateur._id,
      nomComplet: utilisateur.nomComplet,
      email: utilisateur.email,
      telephone: utilisateur.telephone,
      pays: utilisateur.pays,
      numeroCompte: utilisateur.numeroCompte,
      devise: deviseUtilisateur,
      solde: soldeDansLaDevise,
      kyc: {
        etat: utilisateur.kyc.etat,
        documents: utilisateur.kyc.documents,
        dateVerification: utilisateur.kyc.dateVerification
      },
      statusCompte: utilisateur.statusCompte,
      dateCreation: utilisateur.dateCreation,
      dateMiseAJour: utilisateur.dateMiseAJour,
      compteStellar: {
          clePublique: utilisateur.compteStellar.clePublique
      }
    };

    res.status(200).json({
      message: "Profil utilisateur récupéré avec succès",
      utilisateur: utilisateurAEnvoyer
    });

  } catch (erreur) {
    console.error("Erreur lors de la récupération du profil :", erreur);
    res.status(500).json({ message: "Erreur lors de la récupération du profil." });
  }
};