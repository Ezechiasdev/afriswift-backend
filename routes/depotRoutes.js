const express = require("express");
const router = express.Router();
const depotController = require("../controllers/depotController");

// Dépôt utilisateur béninois
router.post("/benin", depotController.depotBenin);

module.exports = router;

