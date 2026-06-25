workspace "Shop" "Library-API demo" {

    model {
        shop = softwareSystem "Shop" {
            orders = container "Orders Service" "Handles orders" "Node.js"
            orders-db = container "Orders DB" "Order storage" "PostgreSQL"
        }

        orders -> orders-db "reads/writes"
    }
}
