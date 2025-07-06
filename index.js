const express = require("express");
const mongoose = require("mongoose");
const userRoutes = require("./routes/userRoutes");
const depotRoutes = require("./routes/depotRoutes");
require("dotenv").config();

// 🔐 FedaPay SDK setup
require('./fedapay.config');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());

// Connexion MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connexion à MongoDB réussie"))
  .catch(err => console.error("❌ Erreur de connexion MongoDB :", err));

// Routes
app.use("/api/users", userRoutes);
app.use("/api/depot", depotRoutes); // 🚀 Nouvelle route ajoutée ici

app.get("/", (req, res) => {
  res.send("✅ API AfriSwift fonctionne !");
});


// Démarrage serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur AfriSwift backend démarré sur le port ${PORT}`);
});
