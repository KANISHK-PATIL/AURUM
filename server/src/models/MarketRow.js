import mongoose from 'mongoose';

const marketRowSchema = new mongoose.Schema({
  date: { type: String, required: true, index: true },
  symbol: { type: String, required: true, enum: ['GOLD','GOLDM','GOLDTEN','GOLDGUINEA','GOLDPETAL'] },
  expiry: { type: String, required: true },
  settlePaise: { type: Number, required: true, min: 1 },
  volume: { type: Number, required: true, min: 0 },
  comexCentsPerOz: { type: Number, required: true, min: 1 },
  usdinrE4: { type: Number, required: true, min: 1 },
  source: { type: String, enum: ['synthetic','csv'], default: 'synthetic' }
}, { timestamps: true });

marketRowSchema.index({ date: 1, symbol: 1, expiry: 1 }, { unique: true });
export default mongoose.model('MarketRow', marketRowSchema);
