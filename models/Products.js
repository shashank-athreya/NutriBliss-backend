const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
    name: String,
    price: Number,
    image: String,

    category: {
        type: String,
        enum: ["Cashew", "Almond", "Pistachio", "Walnut", "Mixed"],
        default: "Mixed"
    },

    stock: {
        type: Number,
        default: 10
    }
});

module.exports = mongoose.model("Product", productSchema);