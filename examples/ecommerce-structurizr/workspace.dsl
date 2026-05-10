workspace "Demo Workspace" "Microservice architecture with three bounded contexts" {

    model {
        payment = softwareSystem "Payment Provider" {
            tags "External"
        }
        notifications = softwareSystem "Notification Provider" {
            tags "External"
        }

        orders = softwareSystem "Orders" {
            orders_api = container "Orders API" "Order management"
            orders_acl = container "Orders ACL" "Payment integration" {
                tags "acl"
            }
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
            fulfillment_acl = container "Fulfillment ACL" "Notification integration" {
                tags "acl"
            }
            fulfillment_crud = container "Fulfillment CRUD" "Shipping data access" {
                tags "repo"
            }
            fulfillment_db = container "Fulfillment DB" "Shipping storage" "PostgreSQL"
        }

        orders_api -> orders_crud "HTTP"
        orders_api -> orders_acl "HTTP"
        orders_crud -> orders_db "PostgreSQL"
        orders_acl -> payment "https://gateway.int.com:443/payment/v1"

        orders_api -> inventory_api "HTTP"
        orders_api -> fulfillment_api "HTTP"

        inventory_api -> inventory_crud "HTTP"
        inventory_crud -> inventory_db "PostgreSQL"

        fulfillment_api -> fulfillment_crud "HTTP"
        fulfillment_api -> fulfillment_acl "HTTP"
        fulfillment_crud -> fulfillment_db "PostgreSQL"
        fulfillment_acl -> notifications "https://gateway.int.com:443/notify/v1"
    }

    views {
        systemLandscape {
            include *
            autolayout lr
        }
    }
}
