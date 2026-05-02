const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
    name: String,
    address: String,
    phone: String,
    items: Array,
    total: Number,
    paymentId: String,
    coupon: String,

    status: {
        type: String,
        default: "Pending"
    },

    note: {
        type: String,
        default: ""
    },

    date: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Order", orderSchema);