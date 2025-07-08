// routes/transactionRoutes.js

const express = require("express");
const router = express.Router();
const transactionController = require("../controllers/transactionController"); // Assurez-vous d'importer le bon contrôleur
const authMiddleware = require("../middleware/authMiddleware");

// Route pour simuler le dépôt Mobile Money vers SRT (TestAnchor)
router.post("/depot-mm-stellar", authMiddleware.verifierToken, transactionController.depotMobileMoneyVersStellar);

// Route pour effectuer une transaction SRT (P2P) entre utilisateurs AfriSwift
router.post("/envoyer-srt", authMiddleware.verifierToken, transactionController.effectuerTransactionStellar);

module.exports = router;