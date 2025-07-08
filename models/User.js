// models/User.js

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  nomComplet: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  telephone: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  pays: {
    type: String,
    required: true,
  },
  numeroCompte: {
    type: String,
    required: true,
    unique: true,
  },
  motDePasseHache: {
    type: String,
    required: true,
    select: false,
  },
  compteStellar: {
    clePublique: {
      type: String,
      required: true,
      unique: true,
    },
    cleSecrete: {
      type: String,
      required: true,
      unique: true,
      select: false, // Très important : ne pas renvoyer la clé secrète par défaut
    },
  },
  solde: {
    // Il est préférable de stocker les soldes par code d'actif, surtout pour les actifs de l'anchor
    // Cela permet de gérer XLM, SRT, USDC, XOF (si un jour), etc.
    XLM: { type: Number, default: 0 },
    SRT: { type: Number, default: 0 }, // Nouveau champ pour l'actif de TestAnchor
    USDC: { type: Number, default: 0 }, // Si vous décidez d'utiliser USDC de TestAnchor
    // XOF: { type: Number, default: 0 }, // Pour le futur si vous intégrez une vraie anchor XOF
    // GHS: { type: Number, default: 0 }, // Pour le futur si vous intégrez une vraie anchor GHS
  },
  kyc: {
    etat: {
      type: String,
      enum: ["en attente", "approuvé", "rejeté"],
      default: "en attente",
    },
    documents: [
      {
        type: String, // URL vers le document stocké
      },
    ],
    dateVerification: {
      type: Date,
    },
  },
  // Optionnel : un champ pour savoir quelles trustlines l'utilisateur a configurées
  trustlines: [{
    assetCode: String,
    issuer: String,
    established: { type: Boolean, default: false }
  }],
  statusCompte: {
    type: String,
    enum: ["actif", "inactif", "bloqué"],
    default: "actif",
  },
  dateCreation: {
    type: Date,
    default: Date.now,
  },
  dateMiseAJour: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("User", userSchema);