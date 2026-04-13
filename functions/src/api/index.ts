import express = require('express');
import { Request, Response } from 'express';
const cors = require('cors');
import { calculateUnifiedPlan, TreatmentInput } from '../healthcare/services/unifiedPricingEngine';
import { FACIAL_TREATMENTS } from '../healthcare/config/treatments';
import { SKIN_TREATMENTS } from '../skin/config/treatments';
import { TREATMENTS as DENTAL_TREATMENTS } from '../dental/config/treatments';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ─────────────────────────────────────────
// GET /treatments?domain=...
// ─────────────────────────────────────────
app.get('/treatments', (req: Request, res: Response) => {
  try {
    const domain = req.query.domain as string;

    if (domain === 'facial') {
      return res.json({ success: true, catalogue: FACIAL_TREATMENTS, domain: 'facial' });
    }
    
    if (domain === 'skin') {
      return res.json({ success: true, catalogue: SKIN_TREATMENTS, domain: 'skin' });
    }
    
    if (domain === 'dental') {
      // Map the object to an array format for REST consumption
      const dentalArray = Object.entries(DENTAL_TREATMENTS).map(([key, value]) => ({
        id: key,
        ...value
      }));
      return res.json({ success: true, catalogue: dentalArray, domain: 'dental' });
    }

    return res.status(400).json({ 
      success: false, 
      error: 'Missing or invalid domain parameter. Use ?domain=facial|skin|dental' 
    });
  } catch (error: any) {
    console.error('Error fetching treatments:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal error' });
  }
});

// ─────────────────────────────────────────
// POST /treatment-plan
// ─────────────────────────────────────────
app.post('/treatment-plan', (req: Request, res: Response) => {
  try {
    const inputs: TreatmentInput[] = req.body;
    
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid payload. Must be an array of treatments.' 
      });
    }

    const planData = calculateUnifiedPlan(inputs);

    const safeBreakdown = planData.breakdown.map(({ platformFee, doctorEarning, ...rest }) => rest);
    const { totalPlatformFee, totalDoctorEarning, ...safePricing } = planData;

    return res.json({
      success: true,
      data: {
        breakdown: safeBreakdown,
        totalBeforeDeduction: safePricing.totalBeforeDeduction,
        consultationDeduction: safePricing.consultationDeduction,
        finalPayable: safePricing.finalPayable
      }
    });
  } catch (error: any) {
    console.error('Error calculating treatment plan:', error);
    return res.status(400).json({ success: false, error: error.message || 'Calculation error' });
  }
});

export const unifiedApiApp = app;
