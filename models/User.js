// models/User.js

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true,
  },
  lastName: {
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
    cleSecrete: { // La clé secrète Stellar (S...)
      type: String,
      required: true,
      unique: true,
      select: false, // Ne pas exposer par défaut
    },
    phraseDeRecuperation: { // La phrase mnémonique BIP-39
      type: String,
      required: true,
      unique: true, // La phrase mnémonique est aussi unique
      select: false, // Ne pas exposer par défaut
    },
  },
  solde: {
    XLM: { type: Number, default: 0 },
    SRT: { type: Number, default: 0 },
    USDC: { type: Number, default: 0 },
    XOF: { type: Number, default: 0 },
    GHS: { type: Number, default: 0 },
  },
  kyc: {
    etat: {
      type: String,
      enum: ["en attente", "approuvé", "rejeté"],
      default: "en attente",
    },
    documents: [
      {
        type: String,
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
  bankDetails: {
    bankAccountNumber: { type: String, default: null },
    bankAccountType: { type: String, default: null },
    bankName: { type: String, default: null },
    bankBranch: { type: String, default: null },
    bankClearingCode: { type: String, default: null },
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
