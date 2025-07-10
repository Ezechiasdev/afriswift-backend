// routes/userRoutes.js

const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const transactionController = require("../controllers/transactionController"); // AJOUTÉ POUR LA NOUVELLE ROUTE
const authMiddleware = require("../middleware/authMiddleware");

// Route d'inscription
router.post("/inscription", userController.inscription);

// Route de connexion
router.post("/connexion", userController.connexion);

// Route pour obtenir le profil de l'utilisateur (PROTÉGÉE)
router.get("/profil", authMiddleware.verifierToken, userController.getProfil);

// NOUVELLE ROUTE : Enregistrer les informations bancaires de l'utilisateur (PROTÉGÉE)
router.post("/bank-details", authMiddleware.verifierToken, transactionController.enregistrerInfosBancaires);

module.exports = router;
