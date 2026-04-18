const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");

const app = express();

app.use(cors());
app.use(express.json());

// ✅ MODELS
const Product = require("./models/Products");
const Order = require("./models/order");

// ================= MONGODB CONNECTION =================

// 🔥 REPLACE WITH YOUR REAL USERNAME, PASSWORD & CLUSTER
mongoose.connect("mongodb+srv://admin:shashank123456@cluster0.laefhww.mongodb.net/nutribliss?retryWrites=true&w=majority")
.then(() => console.log("MongoDB Atlas connected ✅"))
.catch(err => console.log("DB error ❌", err));


// ================= RAZORPAY =================

const razorpay = new Razorpay({
    key_id: "rzp_test_SdHJXu7iVmjrLs",
    key_secret: "h1AQ6qnZFmG3Y5re5yWcq65d"
});


// ================= PRODUCTS APIs =================

// Get all products
app.get("/products", async (req, res) => {
    const products = await Product.find();
    res.json(products);
});

// Add product
app.post("/products", async (req, res) => {
    const { name, price, image } = req.body;

    const product = new Product({
        name,
        price,
        image: image || "https://via.placeholder.com/200"
    });

    await product.save();
    res.json({ message: "Product added successfully" });
});

// Delete product
app.delete("/products/:id", async (req, res) => {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted successfully" });
});

// Update product
app.put("/products/:id", async (req, res) => {
    const { name, price, image } = req.body;

    await Product.findByIdAndUpdate(req.params.id, {
        name,
        price,
        image
    });

    res.json({ message: "Product updated successfully" });
});


// ================= PAYMENT API =================

app.post("/create-order", async (req, res) => {
    try {
        const { amount } = req.body;

        const options = {
            amount: amount * 100,
            currency: "INR",
            receipt: "order_rcptid_11"
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
            status: "Pending"
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
    const orders = await Order.find().sort({ date: -1 });
    res.json(orders);
});


// ================= UPDATE STATUS =================

app.put("/orders/:id", async (req, res) => {
    const { status } = req.body;

    await Order.findByIdAndUpdate(req.params.id, { status });

    res.json({ message: "Status updated" });
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