// models/User.js

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  // Ancien: nomComplet: { type: String, required: true },
  firstName: { // Nouveau champ
    type: String,
    required: true,
    trim: true,
  },
  lastName: { // Nouveau champ
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
      select: false,
    },
  },
  solde: {
    XLM: { type: Number, default: 0 },
    SRT: { type: Number, default: 0 },
    USDC: { type: Number, default: 0 },
    XOF: { type: Number, default: 0 }, // Ajouté pour le futur si besoin
    GHS: { type: Number, default: 0 }, // Ajouté pour le futur si besoin
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
  trustlines: [{
    assetCode: String,
    issuer: String,
    established: { type: Boolean, default: false }
  }],
  // NOUVEAU CHAMP : Informations bancaires
  bankDetails: {
    bankAccountNumber: { type: String, default: null },
    bankAccountType: { type: String, default: null }, // ex: checking, savings
    bankName: { type: String, default: null },
    bankBranch: { type: String, default: null }, // Optionnel
    bankClearingCode: { type: String, default: null }, // Optionnel
  },
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