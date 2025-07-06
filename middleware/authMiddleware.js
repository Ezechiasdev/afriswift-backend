// afriSwift-backend/middleware/authMiddleware.js

const jwt = require("jsonwebtoken");
const User = require("../models/User"); // Pourrait être utile si on veut récupérer l'utilisateur complet

exports.verifierToken = async (req, res, next) => {
  // 1. Vérifier si l'en-tête Authorization est présent
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: "Accès non autorisé : Aucun token fourni ou format invalide." });
  }

  // 2. Extraire le token (ignorer "Bearer ")
  const token = authHeader.split(' ')[1];

  try {
    // 3. Vérifier et décoder le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 4. Attacher l'utilisateur décodé à l'objet req
    // Pour des raisons de performance, on ne récupère pas toujours l'utilisateur complet de la BD ici.
    // Le payload du token contient déjà l'ID et l'email.
    req.utilisateur = decoded; // Vous pouvez accéder à req.utilisateur.id, req.utilisateur.email, etc.

    // 5. Passer au middleware/contrôleur suivant
    next();

  } catch (erreur) {
    console.error("Erreur de vérification du token :", erreur);
    if (erreur.name === 'TokenExpiredError') {
      return res.status(401).json({ message: "Accès non autorisé : Token expiré." });
    }
    return res.status(401).json({ message: "Accès non autorisé : Token invalide." });
  }
};