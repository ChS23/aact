workspace "Shop" "Intended C4 architecture for the Shop platform" {

    model {
        shop = softwareSystem "Shop" {
            orders-api = container "Orders API" "Accepts and orchestrates orders" "Node.js"
            orders-repo = container "Orders Repo" "Owns order persistence" "Node.js" {
                tags "repo"
            }
            orders-db = container "Orders DB" "Order storage" "PostgreSQL"

            billing-service = container "Billing Service" "Charges and issues invoices" "Go"
            billing-repo = container "Billing Repo" "Owns invoice persistence" "Go" {
                tags "repo"
            }
            billing-db = container "Billing DB" "Invoice storage" "PostgreSQL"
        }

        # Intended flow: no service touches a database directly — all
        # persistence goes through a repository layer.
        orders-api -> orders-repo
        orders-repo -> orders-db
        orders-api -> billing-service
        billing-service -> billing-repo
        billing-repo -> billing-db
    }

    views {
        systemLandscape {
            include *
            autolayout lr
        }
    }
}
