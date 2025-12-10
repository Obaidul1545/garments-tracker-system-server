const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 3000;
const admin = require('firebase-admin');

// const serviceAccount = require('./garments-tracker-firebase-adminsdk.json');

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
  'utf8'
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const timePart = Date.now().toString().slice(-4);
  const random = Math.floor(100000 + Math.random() * 900000).toString();
  return timePart + random;
}

// Middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers?.authorization;
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
};

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    await client.connect();

    const db = client.db('garments_tracker_db');
    const usersCollection = db.collection('users');
    const productsCollection = db.collection('products');
    const ordersCollection = db.collection('orders');
    const trackingsCollection = db.collection('trackings');

    // middle ware
    const logTracking = async (trackingId, status) => {
      const log = {
        trackingId,
        status,
        details: status.split('_').join(' '),
        createdAt: new Date(),
      };
      const result = await trackingsCollection.insertOne(log);
      return result;
    };

    const generateOrderId = async () => {
      const lastOrder = await ordersCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      if (lastOrder.length === 0) {
        return 'ORD001';
      }
      const lastId = lastOrder[0].orderId;
      const lastNumber = parseInt(lastId.replace('ORD', ''));
      const newNumber = lastNumber + 1;
      const orderId = 'ORD' + newNumber.toString().padStart(3, '0');
      return orderId;
    };

    // users releted apis
    app.post('/users', async (req, res) => {
      const user = req.body;
      user.accountStatus = 'pending';
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await usersCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: 'Already user Exists' });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get('/users', async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ error: 'Email missing' });
      }
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    app.get('/manage-users', async (req, res) => {
      try {
        const { search, role } = req.query;
        const query = {};
        if (search) {
          query.$or = [
            { displayName: { $regex: search, $options: 'i' } },
            { role: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
          ];
        }
        if (role && role !== 'all') {
          query.role = role;
        }
        const result = await usersCollection.find(query).toArray();
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/users/:email/role', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || 'user' });
    });

    app.patch('/update-user', verifyFBToken, async (req, res) => {
      try {
        const { email, role, accountStatus } = req.body;

        const updateDoc = {};
        if (role) updateDoc.role = role;
        if (accountStatus) updateDoc.accountStatus = accountStatus;

        const result = await usersCollection.updateOne(
          { email },
          { $set: updateDoc }
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // products releted apis
    app.get('/all-products', async (req, res) => {
      try {
        const { search } = req.query;
        const query = {};
        if (search) {
          query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
            { category: { $regex: search, $options: 'i' } },
          ];
        }
        const result = await productsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/product/:id', async (req, res) => {
      try {
        const productId = req.params.id;
        const query = { _id: new ObjectId(productId) };
        const result = await productsCollection.findOne(query);
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/latest-products', async (req, res) => {
      try {
        const query = { showOnHome: true };
        const result = await productsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .limit(6)
          .toArray();
        res.status(200).send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Server error' });
      }
    });

    // orders releted apis
    app.post('/orders', verifyFBToken, async (req, res) => {
      try {
        const orderData = req.body;
        const trackingId = generateTrackingId();
        const orderId = generateOrderId();
        orderData.createdAt = new Date();
        orderData.orderId = orderId;
        orderData.trackingId = trackingId;
        orderData.status = 'pending';
        logTracking(trackingId, 'Order_Created');
        const result = await ordersCollection.insertOne(orderData);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/all-orders', async (req, res) => {
      try {
        const { search, sortByStatus } = req.query;
        const query = {};
        if (search) {
          query.$or = [
            { orderId: { $regex: search, $options: 'i' } },
            { firstName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { productTitle: { $regex: search, $options: 'i' } },
            { status: { $regex: search, $options: 'i' } },
          ];
        }
        if (sortByStatus && sortByStatus !== 'all') {
          query.sortByStatus = sortByStatus;
        }
        const result = await ordersCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/orders-by-email', async (req, res) => {
      try {
        const { email, search, sortByStatus } = req.query;
        const query = {};
        if (email) {
          query.email = email;
        }
        if (search) {
          query.$or = [
            { orderId: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { productTitle: { $regex: search, $options: 'i' } },
            { status: { $regex: search, $options: 'i' } },
          ];
        }

        if (sortByStatus && sortByStatus !== 'all') {
          query.status = sortByStatus;
        }

        const result = await ordersCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Garments Tracker is Running');
});

app.listen(port, () => {
  console.log(`Garments tracker app listening on port ${port}`);
});
