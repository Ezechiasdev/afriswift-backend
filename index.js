// index.js

    const express = require("express");
    const mongoose = require("mongoose");
    require("dotenv").config();
    const userRoutes = require("./routes/userRoutes");
    const transactionRoutes = require("./routes/transactionRoutes"); 

    const app = express();
    const PORT = process.env.PORT || 3000;

    // Middlewares
    app.use(express.json());

    // Middleware de log général pour toutes les requêtes
    app.use((req, res, next) => {
      console.log(`[${new Date().toISOString()}] Requête reçue: ${req.method} ${req.url}`);
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
    
    module.exports = app;