    // routes/transactionRoutes.js

    const express = require("express");
    const router = express.Router();
    const transactionController = require("../controllers/transactionController");
    const authMiddleware = require("../middleware/authMiddleware");

    console.log("transactionRoutes.js chargé.");

    // Route pour simuler le dépôt Bancaire vers SRT (TestAnchor)
    router.post("/depot-bancaire-stellar", (req, res, next) => {
        console.log("Requête POST /depot-bancaire-stellar reçue dans transactionRoutes.");
        next();
    }, authMiddleware.verifierToken, transactionController.depotBancaireVersStellar); 

    // Route pour effectuer une transaction SRT (P2P) entre utilisateurs AfriSwift
    router.post("/envoyer-srt", (req, res, next) => {
        console.log("Requête POST /envoyer-srt reçue dans transactionRoutes.");
        next();
    }, authMiddleware.verifierToken, transactionController.effectuerTransactionStellar);

    // Route pour effectuer le retrait 
    router.post("/retrait-stellar-bancaire", (req, res, next) => {
        console.log("Requête POST /retrait-stellar-bancaire reçue dans transactionRoutes.");
        next();
    }, authMiddleware.verifierToken, transactionController.retraitStellarVersBancaire);

    module.exports = router;
    