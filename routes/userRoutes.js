const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware"); 

// Route d'inscription
router.post("/inscription", userController.inscription);

// Route de connexion (AJOUTEZ CETTE LIGNE)
router.post("/connexion", userController.connexion);

// Route pour obtenir le profil de l'utilisateur (PROTÉGÉE)
// Ezéchias remarque l'ordre : d'abord le middleware, ensuite le contrôleur
router.get("/profil", authMiddleware.verifierToken, userController.getProfil); 

// D'autres routes viendront ici (connexion, dépôt, etc.)

module.exports = router;

