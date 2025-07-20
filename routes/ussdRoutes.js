// routes/ussdRoutes.js

const express = require("express");
const router = express.Router();
const ussdController = require("../controllers/ussdController");

// Route pour gérer les requêtes USSD entrantes d'Africa's Talking
router.post("/", ussdController.handleUssdRequest);

module.exports = router;