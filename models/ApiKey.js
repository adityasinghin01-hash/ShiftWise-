// models/ApiKey.js
// Stores API keys. Built with security-first design: raw keys are never stored, only hashes.

const mongoose = require('mongoose');

const apiKeySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: [50, 'API Key name cannot exceed 50 characters'],
    },
    keyHash: {
      type: String,
      required: true,
      unique: true, // SHA-256 HMAC of the raw key
    },
    keyPrefix: {
      type: String,
      required: true, // For UI display (e.g., "sk_live_a1b2c3d4")
    },
    scopes: {
      type: [String],
      default: ['api:read'], // Default least-privilege scope
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null, // null = never expires
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    usageCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to quickly fetch active keys for a specific user
apiKeySchema.index({ userId: 1, isActive: 1 });

const ApiKey = mongoose.model('ApiKey', apiKeySchema);

module.exports = ApiKey;
