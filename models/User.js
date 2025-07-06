const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  nomComplet: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  telephone: { type: String, required: true },
  pays: { type: String, required: true },
  numeroCompte: { type: String, unique: true, required: true },
  motDePasseHache: { type: String, required: true },
  compteStellar: {
    clePublique: { type: String, required: true },
    cleSecrete: { type: String, required: true, select: false } // Ajouté ou mis à jour
  },
  solde: { // Ajouté
    USD: { type: Number, default: 0 },
    XLM: { type: Number, default: 0 },
    NGN: { type: Number, default: 0 },
    GHS: { type: Number, default: 0 }
  },
  kyc: { // Ajouté
    etat: { type: String, enum: ["en_attente", "approuvé", "rejeté"], default: "en_attente" },
    documents: { type: [String], default: [] },
    dateVerification: { type: Date }
  },
  statusCompte: { type: String, enum: ["actif", "bloqué"], default: "actif" }, // Ajouté
  dateCreation: { type: Date, default: Date.now }, // Ajouté
  dateMiseAJour: { type: Date, default: Date.now } // Ajouté
});

// Optionnel: utiliser { timestamps: true } pour dateCreation et dateMiseAJour
// const userSchema = new mongoose.Schema({
//   nomComplet: { type: String, required: true },
//   email: { type: String, unique: true, required: true },
//   telephone: { type: String, required: true },
//   pays: { type: String, required: true },
//   numeroCompte: { type: String, unique: true, required: true },
//   motDePasseHache: { type: String, required: true },
//   compteStellar: {
//     clePublique: { type: String, required: true },
//     cleSecrete: { type: String, required: true, select: false }
//   },
//   solde: {
//     USD: { type: Number, default: 0 },
//     XLM: { type: Number, default: 0 },
//     NGN: { type: Number, default: 0 },
//     GHS: { type: Number, default: 0 }
//   },
//   kyc: {
//     etat: { type: String, enum: ["en_attente", "approuvé", "rejeté"], default: "en_attente" },
//     documents: { type: [String], default: [] },
//     dateVerification: { type: Date }
//   },
//   statusCompte: { type: String, enum: ["actif", "bloqué"], default: "actif" }
// }, {
//   timestamps: true // Gère automatiquement createdAt et updatedAt
// });


module.exports = mongoose.model("User", userSchema);