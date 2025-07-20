// index.js

const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const userRoutes = require("./routes/userRoutes");
const transactionRoutes = require("./routes/transactionRoutes"); 
const ussdRoutes = require("./routes/ussdRoutes"); // NOUVEL IMPORT

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
// Africa's Talking envoie des données URL-encoded pour USSD, donc besoin de ce middleware
app.use(express.urlencoded({ extended: true })); // NOUVEAU MIDDLEWARE

// Middleware de log général pour toutes les requêtes (utile pour le débogage)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] Requête reçue: ${req.method} ${req.url}`);
  // Log du corps de la requête pour USSD
  if (req.method === 'POST' && req.url === '/api/ussd') {
      console.log("USSD Request Body:", req.body);
  }
  next();
});

// Connexion MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connexion à MongoDB réussie"))
  .catch(err => console.error("❌ Erreur de connexion MongoDB :", err));

// Routes
console.log("Enregistrement des routes /api/users...");
app.use("/api/users", userRoutes);
console.log("Enregistrement des routes /api/transactions...");
app.use("/api/transactions", transactionRoutes);
console.log("Enregistrement des routes /api/ussd...");
app.use("/api/ussd", ussdRoutes); // NOUVELLE ROUTE USSD

app.get("/", (req, res) => {
  res.send("✅ API AfriSwift fonctionne !");
});

// Middleware de gestion des erreurs 404 (si aucune route n'a été trouvée)
app.use((req, res, next) => {
    console.warn(`[${new Date().toISOString()}] Erreur 404: Aucune route trouvée pour ${req.method} ${req.url}`);
    res.status(404).send('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Error</title></head><body><pre>Cannot ' + req.method + ' ' + req.url + '</pre></body></html>');
});


// Démarrage serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur AfriSwift backend démarré sur le port ${PORT}`);
});
