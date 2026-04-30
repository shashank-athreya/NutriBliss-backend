const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
    name: String,
    price: Number,
    image: String,

    // ✅ NEW FIELD
    category: {
        type: String,
        enum: ["Cashew", "Almond", "Pistachio", "Walnut", "Mixed"],
        default: "Mixed"
    }
});

module.exports = mongoose.model("Product", productSchema);