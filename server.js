const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());

// ================= MODELS =================
const Product = require("./models/Products");
const Order = require("./models/order");

// ================= MONGODB CONNECTION =================
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB Atlas connected ✅"))
.catch(err => {
    console.log("DB error ❌", err);
    process.exit(1); // stop server if DB fails
});

// ================= RAZORPAY =================
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ================= PRODUCTS APIs =================

// Get all products
app.get("/products", async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch products" });
    }
});

// Add product
app.post("/products", async (req, res) => {
    try {
        const { name, price, image } = req.body;

        const product = new Product({
            name,
            price,
            image: image || "https://via.placeholder.com/200"
        });

        await product.save();
        res.json({ message: "Product added successfully" });

    } catch (err) {
        res.status(500).json({ error: "Failed to add product" });
    }
});

// Delete product
app.delete("/products/:id", async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.json({ message: "Deleted successfully" });

    } catch (err) {
        res.status(500).json({ error: "Delete failed" });
    }
});

// Update product
app.put("/products/:id", async (req, res) => {
    try {
        const { name, price, image } = req.body;

        await Product.findByIdAndUpdate(req.params.id, {
            name,
            price,
            image
        });

        res.json({ message: "Product updated successfully" });

    } catch (err) {
        res.status(500).json({ error: "Update failed" });
    }
});

// ================= PAYMENT API =================

app.post("/create-order", async (req, res) => {
    try {
        const { amount } = req.body;

        if (!amount) {
            return res.status(400).json({ error: "Amount is required" });
        }

        const options = {
            amount: amount * 100, // paise
            currency: "INR",
            receipt: "receipt_" + Date.now()
        };

        const order = await razorpay.orders.create(options);
        res.json(order);

    } catch (error) {
        console.log("Razorpay Error:", error);
        res.status(500).json({ error: "Payment failed" });
    }
});

// ================= SAVE ORDER =================

app.post("/save-order", async (req, res) => {
    try {
        const { name, address, phone, cart, total, paymentId } = req.body;

        const newOrder = new Order({
            name,
            address,
            phone,
            items: cart,
            total,
            paymentId,
            status: "Pending",
            date: new Date()
        });

        await newOrder.save();

        res.json({ message: "Order saved successfully" });

    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Failed to save order" });
    }
});

// ================= GET ORDERS =================

app.get("/orders", async (req, res) => {
    try {
        const orders = await Order.find().sort({ date: -1 });
        res.json(orders);

    } catch (err) {
        res.status(500).json({ error: "Failed to fetch orders" });
    }
});

// ================= UPDATE STATUS =================

app.put("/orders/:id", async (req, res) => {
    try {
        const { status } = req.body;

        await Order.findByIdAndUpdate(req.params.id, { status });

        res.json({ message: "Status updated" });

    } catch (err) {
        res.status(500).json({ error: "Status update failed" });
    }
});

// ================= ROOT =================

app.get("/", (req, res) => {
    res.send("Server is running 🚀");
});

// ================= SERVER =================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});