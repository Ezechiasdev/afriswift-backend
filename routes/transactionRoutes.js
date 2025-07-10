// routes/transactionRoutes.js

const express = require("express");
const router = express.Router();
const transactionController = require("../controllers/transactionController");
const authMiddleware = require("../middleware/authMiddleware");

// Route pour simuler le dépôt Bancaire vers SRT (TestAnchor)
router.post("/depot-bancaire-stellar", authMiddleware.verifierToken, transactionController.depotBancaireVersStellar); // NOM DE ROUTE MODIFIÉ

// Route pour effectuer une transaction SRT (P2P) entre utilisateurs AfriSwift
router.post("/envoyer-srt", authMiddleware.verifierToken, transactionController.effectuerTransactionStellar);

module.exports = router;
