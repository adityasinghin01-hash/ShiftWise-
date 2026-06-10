// scripts/create-subscription.js
// One-time script to add a free subscription to the test admin user

const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');
const { createDefaultFreeSubscription } = require('../services/subscriptionService');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const user = await User.findOne({ email: 'testadmin@spinx.dev' });
    if (!user) {
      console.log('User not found');
      return;
    }

    const sub = await createDefaultFreeSubscription(user._id);
    await User.findByIdAndUpdate(user._id, {
      activeSubscription: sub._id,
      pendingSubscriptionCreation: false,
    });
    console.log('✅ Subscription created:', sub._id.toString());
    console.log('✅ User updated with activeSubscription');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.disconnect();
  }
})();
