// scripts/seed-plans.js
// Seeds the three plan tiers into MongoDB.
// Usage: node scripts/seed-plans.js
// Safe to re-run — uses upsert to avoid duplicates.

require('dotenv').config();
const mongoose = require('mongoose');
const Plan = require('../models/Plan');

const plans = [
  {
    name: 'free',
    displayName: 'Free',
    price: 0,
    currency: 'USD',
    billingPeriod: 'monthly',
    features: ['Basic API access', '1 API key', 'Community support', '100MB storage'],
    limits: {
      apiCallsPerMonth: 1000,
      maxApiKeys: 1,
      webhooksAllowed: 0,
      storageGB: 0.1, // 100MB
    },
    isActive: true,
  },
  {
    name: 'pro',
    displayName: 'Pro',
    price: 19,
    currency: 'USD',
    billingPeriod: 'monthly',
    features: [
      'Extended API access',
      '5 API keys',
      '5 webhooks',
      '5GB storage',
      'Priority support',
      'Advanced analytics',
    ],
    limits: {
      apiCallsPerMonth: 50000,
      maxApiKeys: 5,
      webhooksAllowed: 5,
      storageGB: 5,
    },
    isActive: true,
  },
  {
    name: 'enterprise',
    displayName: 'Enterprise',
    price: 99,
    currency: 'USD',
    billingPeriod: 'monthly',
    features: [
      'Unlimited API access',
      '25 API keys',
      'Unlimited webhooks',
      '50GB storage',
      'Dedicated support',
      'Custom integrations',
      'SLA guarantee',
    ],
    limits: {
      apiCallsPerMonth: -1, // unlimited
      maxApiKeys: 25,
      webhooksAllowed: -1, // unlimited
      storageGB: 50,
    },
    isActive: true,
  },
];

const seedPlans = async () => {
  let failed = false;

  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI environment variable is not set.');
    }

    console.log('Connecting to database...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    for (const plan of plans) {
      const result = await Plan.findOneAndUpdate(
        { name: plan.name },
        { $set: plan },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );
      console.log(`  ✅ Plan '${result.displayName}' seeded ($${result.price}/mo)`);
    }

    console.log(`\n✅ All ${plans.length} plans seeded successfully.`);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    failed = true;
  } finally {
    await mongoose.connection.close();
    console.log('Disconnected from database.');
    process.exit(failed ? 1 : 0);
  }
};

seedPlans();
