workspace "Shop" "Library-API demo" {

    model {
        shop = softwareSystem "Shop" {
            orders = container "Orders Service" "Handles orders" "Node.js"
            orders-repo = container "Orders Repository" "Owns persistence" "Node.js" {
                tags "repo"
            }
            orders-db = container "Orders DB" "Order storage" "PostgreSQL"
        }

        orders -> orders-repo
        orders-repo -> orders-db
    }
}
