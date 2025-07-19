from stellar_sdk import Server

# Clé publique de l'utilisateur à vérifier
# Remplacez cette clé par la clé publique exacte que votre backend a générée
# pour l'utilisateur qui ne s'affiche pas sur Stellar Expert.
public_key = "GCNNJFP5YX67O3YYAQAK5CA3DZ63SAVHF5BPZCQKBOT5M4QFIKV3AEHQ" 

# URL du serveur Horizon Testnet
horizon_url = "https://horizon-testnet.stellar.org"
server = Server(horizon_url)

try:
    # Tente de récupérer les détails du compte depuis Horizon
    account_details = server.accounts().account_id(public_key).call()
    print(f"Compte trouvé sur Horizon :")
    print(f"  ID du compte : {account_details['id']}")
    print(f"  Solde XLM : {account_details['balances'][0]['balance']}")
    print(f"  Nombre de séquences : {account_details['sequence']}")
    print(f"  Balances complètes : {account_details['balances']}")
except Exception as e:
    # Affiche une erreur si le compte n'est pas trouvé ou si une autre erreur se produit
    print(f"Erreur lors de la récupération du compte sur Horizon : {e}")
    print(f"Le compte {public_key} n'a pas été trouvé ou une erreur est survenue.")

