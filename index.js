const express = require("express");
const mongoose = require("mongoose");
const userRoutes = require("./routes/userRoutes");
const depotRoutes = require("./routes/depotRoutes");
const transactionRoutes = require("./routes/transactionRoutes"); 
require("dotenv").config();

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
app.use("/api/transactions", transactionRoutes);

app.get("/", (req, res) => {
  res.send("✅ API AfriSwift fonctionne !");
});


// Démarrage serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur AfriSwift backend démarré sur le port ${PORT}`);
});


