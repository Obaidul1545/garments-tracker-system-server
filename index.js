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

    // users releted apis
    app.get('/users', async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ error: 'Email missing' });
      }
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

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
        const result = await productsCollection.find(query).toArray();
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
