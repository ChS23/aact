workspace "Violations Demo" "Microservice architecture with intentional violations for aact demo." {

    model {
        payment = softwareSystem "Payment Gateway" {
            tags "External"
        }
        notifications = softwareSystem "Notification Provider" {
            tags "External"
        }

        orders = softwareSystem "Orders" {
            orders_api = container "Orders API" "Order management"
            orders_crud = container "Orders CRUD" "Order data access" {
                tags "repo"
            }
            orders_db = container "Orders DB" "Order storage" "PostgreSQL"
        }

        inventory = softwareSystem "Inventory" {
            inventory_api = container "Inventory API" "Stock management"
            inventory_crud = container "Inventory CRUD" "Stock data access" {
                tags "repo"
            }
            inventory_db = container "Inventory DB" "Stock storage" "PostgreSQL"
        }

        fulfillment = softwareSystem "Fulfillment" {
            fulfillment_api = container "Fulfillment API" "Shipping management"
            fulfillment_crud = container "Fulfillment CRUD" "Shipping data access" {
                tags "repo"
            }
            fulfillment_db = container "Fulfillment DB" "Shipping storage" "PostgreSQL"
        }

        # Orders flow
        orders_api -> orders_crud "HTTP"
        orders_api -> payment "REST"
        orders_crud -> orders_db "PostgreSQL"

        # Cross-context
        orders_api -> inventory_api "HTTP"
        orders_api -> fulfillment_api "HTTP"

        # Inventory flow
        inventory_api -> inventory_crud "HTTP"
        inventory_api -> orders_db "SQL"
        inventory_crud -> inventory_db "PostgreSQL"

        # Fulfillment flow
        fulfillment_api -> fulfillment_crud "HTTP"
        fulfillment_api -> notifications "SMTP"
        fulfillment_crud -> fulfillment_db "PostgreSQL"
    }

    views {
        systemLandscape {
            include *
            autolayout lr
        }
    }
}
