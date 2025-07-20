// controllers/ussdController.js

const User = require("../models/User"); 
const mongoose = require("mongoose"); 

// Taux de conversion simulés (à adapter selon vos besoins réels)
const TAUX_XOF_VERS_XLM = 0.0001; 
const TAUX_XLM_VERS_XOF = 10000; 

// --- Logique du menu USSD ---
exports.handleUssdRequest = async (req, res) => {
    const { sessionId, serviceCode, phoneNumber, text } = req.body;

    let response = ""; 
    const args = text.split('*'); 
    const lastInput = args[args.length - 1];
    const level = text === "" ? 0 : args.length;

    console.log(`[USSD Session: ${sessionId}] Phone: ${phoneNumber}, Text: '${text}', Level: ${level}, Last Input: '${lastInput}'`);

    let user = null;
    let userId = null;

    // Tente de trouver l'utilisateur par numéro de téléphone
    try {
        user = await User.findOne({ telephone: phoneNumber });
        if (user) {
            userId = user._id;
            console.log(`[USSD Session: ${sessionId}] Utilisateur trouvé: ${user.email}`); // NOUVEAU LOG
        } else {
            console.log(`[USSD Session: ${sessionId}] Utilisateur NON trouvé pour le numéro: ${phoneNumber}`); // NOUVEAU LOG
        }
    } catch (error) {
        console.error(`Erreur lors de la recherche de l'utilisateur par téléphone ${phoneNumber}:`, error);
        response = "END Une erreur interne est survenue. Veuillez réessayer plus tard.";
        res.send(response);
        return;
    }

    switch (level) {
        case 0:
            if (!user) {
                response = "CON Bienvenue sur AfriSwift!\n";
                response += "1. S'inscrire\n";
                response += "2. Se connecter";
            } else {
                response = `CON Bienvenue ${user.firstName} sur AfriSwift!\n`;
                response += "1. Consulter solde XLM\n";
                response += "2. Envoyer XLM\n";
                response += "3. Retirer XLM\n";
                response += "4. Mettre à jour infos bancaires";
            }
            break;

        case 1:
            if (!user) {
                if (lastInput === "1") {
                    response = "END L'inscription complète n'est pas supportée via USSD pour le moment. Veuillez utiliser l'application mobile ou web.";
                } else if (lastInput === "2") {
                    response = "END La connexion complète n'est pas supportée via USSD pour le moment. Veuillez utiliser l'application mobile ou web.";
                } else {
                    response = "END Choix invalide. Veuillez réessayer.";
                }
            } else {
                switch (lastInput) {
                    case "1":
                        response = `END Votre solde XLM est de ${user.solde.XLM || 0} XLM.`;
                        if (user.solde.XOF) response += `\nVotre solde XOF simulé est de ${user.solde.XOF} XOF.`;
                        if (user.solde.GHS) response += `\nVotre solde GHS simulé est de ${user.solde.GHS} GHS.`;
                        break;
                    case "2":
                        response = "CON Entrez le numéro de compte AfriSwift du destinataire:";
                        break;
                    case "3":
                        response = "CON Entrez le montant en FCFA à retirer (ex: 10000):";
                        break;
                    case "4":
                        response = "END Pour mettre à jour vos informations bancaires, veuillez utiliser l'application mobile ou web.";
                        break;
                    default:
                        response = "END Choix invalide. Veuillez réessayer.";
                        break;
                }
            }
            break;

        case 2:
            if (!user) {
                response = "END Session invalide. Veuillez recommencer.";
                break;
            }

            const previousChoice = args[0]; 

            switch (previousChoice) {
                case "2": 
                    response = "CON Entrez le montant en XLM à envoyer:";
                    break;
                case "3": 
                    const montantXOF = parseFloat(lastInput);
                    if (isNaN(montantXOF) || montantXOF <= 0) {
                        response = "END Montant invalide. Veuillez réessayer.";
                        break;
                    }
                    const montantXLMRetrait = montantXOF / TAUX_XLM_VERS_XOF;
                    
                    if (user.solde.XLM < montantXLMRetrait) {
                        response = `END Solde XLM insuffisant. Votre solde: ${user.solde.XLM} XLM. Requis: ${montantXLMRetrait} XLM.`;
                    } else {
                        user.solde.XLM -= montantXLMRetrait;
                        user.solde.XOF = (user.solde.XOF || 0) + montantXOF; 
                        await user.save();
                        response = `END Retrait de ${montantXOF} FCFA (${montantXLMRetrait} XLM) simulé avec succès. Nouveau solde XLM: ${user.solde.XLM}.`;
                    }
                    break;
                default:
                    response = "END Choix invalide. Veuillez recommencer.";
                    break;
            }
            break;
        
        case 3:
            if (!user) {
                response = "END Session invalide. Veuillez recommencer.";
                break;
            }

            const initialChoice = args[0]; 
            if (initialChoice === "2") { 
                const destinataireNumeroCompte = args[1]; 
                const montantXLMEnvoi = parseFloat(lastInput); 

                if (isNaN(montantXLMEnvoi) || montantXLMEnvoi <= 0) {
                    response = "END Montant invalide. Veuillez réessayer.";
                    break;
                }

                const session = await mongoose.startSession();
                session.startTransaction();

                try {
                    const destinataire = await User.findOne({ numeroCompte: destinataireNumeroCompte }).session(session);
                    if (!destinataire) {
                        response = "END Destinataire non trouvé. Veuillez vérifier le numéro de compte.";
                        await session.abortTransaction();
                        res.send(response); 
                        return;
                    }

                    if (user.solde.XLM < montantXLMEnvoi) {
                        response = `END Solde XLM insuffisant. Votre solde: ${user.solde.XLM} XLM. Requis: ${montantXLMEnvoi} XLM.`;
                        await session.abortTransaction();
                        res.send(response); 
                        return;
                    }

                    user.solde.XLM -= montantXLMEnvoi;
                    destinataire.solde.XLM = (destinataire.solde.XLM || 0) + montantXLMEnvoi;

                    await user.save({ session });
                    await destinataire.save({ session });

                    await session.commitTransaction();
                    response = `END Envoi de ${montantXLMEnvoi} XLM à ${destinataire.firstName} ${destinataire.lastName} (Num: ${destinataireNumeroCompte}) simulé avec succès. Nouveau solde: ${user.solde.XLM} XLM.`;

                } catch (error) {
                    await session.abortTransaction();
                    console.error("Erreur lors de la simulation d'envoi USSD:", error);
                    response = "END Une erreur est survenue lors de l'envoi. Veuillez réessayer.";
                } finally {
                    session.endSession();
                }
            } else {
                response = "END Choix invalide. Veuillez recommencer.";
            }
            break;

        default:
            response = "END Session terminée. Veuillez recommencer.";
            break;
    }

    res.send(response);
};