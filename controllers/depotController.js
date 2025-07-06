const { Transaction } = require('fedapay');
require('../fedapay.config');

exports.depotBenin = async (req, res) => {
  const {
    montant,
    telephone,
    devise,
    description,
    firstname,
    lastname,
    email
  } = req.body;

  try {
    const transaction = await Transaction.create({
      amount: montant || 1000,
      description: description || 'Dépôt Mobile Money Bénin - AfriSwift',
      currency: { iso: devise || 'XOF' },
      callback_url: 'https://afriswift.com/callback',
      transaction_type: 'checkout', // ✅ On force le type pour activer le checkout
      customer: {
        firstname,
        lastname,
        email,
        phone_number: {
          number: telephone,
          country: 'BJ'
        }
      }
    });

    // ✅ Affichage debug complet
    console.log('Transaction FedaPay créée :', transaction);

    return res.status(200).json({
      message: 'Transaction créée avec succès',
      redirect_url: transaction.payment_url, // ✅ UTILISER payment_url ici
      id: transaction.id
    });
  } catch (error) {
    console.error('Erreur création transaction FedaPay:', error);

    return res.status(500).json({
      message: 'Échec de la transaction',
      erreur: error.message || 'Erreur inconnue'
    });
  }
};
