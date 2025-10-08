'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Coins, TrendingUp, AlertTriangle } from 'lucide-react';

interface Credits {
  total: number;
  used: number;
  remaining: number;
  monthlyReset: string;
  planTier: string;
}

export function CreditsDisplay() {
  const { user } = useAuth();
  const [credits, setCredits] = useState<Credits | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchCredits();
    }
  }, [user]);

  const fetchCredits = async () => {
    try {
      const response = await fetch('/api/user/credits', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setCredits(data.credits);
      }
    } catch (error) {
      console.error('Failed to fetch credits:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="w-64">
        <CardContent className="p-4">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!credits) {
    return null;
  }

  const usagePercentage = (credits.used / credits.total) * 100;
  const isLowCredits = credits.remaining < 5;
  const isOutOfCredits = credits.remaining <= 0;

  return (
    <Card className={`w-64 ${isOutOfCredits ? 'border-red-200 bg-red-50' : isLowCredits ? 'border-yellow-200 bg-yellow-50' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-blue-600" />
            <span className="font-medium">Search Credits</span>
          </div>
          <Badge variant="outline" className="text-xs">
            {credits.planTier}
          </Badge>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Remaining</span>
            <span className={`font-bold ${isOutOfCredits ? 'text-red-600' : isLowCredits ? 'text-yellow-600' : 'text-green-600'}`}>
              {credits.remaining}
            </span>
          </div>

          <div className="flex justify-between text-sm">
            <span>Used</span>
            <span>{credits.used} / {credits.total}</span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${
                isOutOfCredits ? 'bg-red-500' : isLowCredits ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(usagePercentage, 100)}%` }}
            ></div>
          </div>

          <div className="flex justify-between items-center text-xs text-gray-600">
            <span>Resets {new Date(credits.monthlyReset).toLocaleDateString()}</span>
            {isLowCredits && (
              <div className="flex items-center gap-1 text-yellow-600">
                <AlertTriangle className="h-3 w-3" />
                <span>Low</span>
              </div>
            )}
            {isOutOfCredits && (
              <div className="flex items-center gap-1 text-red-600">
                <AlertTriangle className="h-3 w-3" />
                <span>Exhausted</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
