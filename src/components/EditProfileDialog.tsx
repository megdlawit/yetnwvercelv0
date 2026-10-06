/**
 * EditProfileDialog — Edit name, location, and preferred park.
 */
import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { ProfileUpdate } from '@/hooks/useUserProfile';

interface EditProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues: {
    fullName: string;
    location: string;
    preferredPark: string;
  };
  onSave: (updates: ProfileUpdate) => Promise<boolean>;
  error?: string | null;
}

const EditProfileDialog: React.FC<EditProfileDialogProps> = ({
  open, onOpenChange, initialValues, onSave, error,
}) => {
  const [fullName, setFullName] = useState(initialValues.fullName);
  const [location, setLocation] = useState(initialValues.location);
  const [preferredPark, setPreferredPark] = useState(initialValues.preferredPark);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFullName(initialValues.fullName);
      setLocation(initialValues.location);
      setPreferredPark(initialValues.preferredPark);
      setLocalError(null);
    }
  }, [open, initialValues]);

  const handleSave = async () => {
    if (!fullName.trim()) {
      setLocalError('Please enter your name.');
      return;
    }
    setSubmitting(true);
    setLocalError(null);
    const ok = await onSave({
      full_name: fullName.trim(),
      location: location.trim() || null,
      preferred_park: preferredPark.trim() || null,
    });
    setSubmitting(false);
    if (ok) {
      onOpenChange(false);
    } else {
      setLocalError(error || 'Could not save profile. Please try again.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>
            Update your display name and preferences.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-location">Location</Label>
            <Input
              id="profile-location"
              placeholder="Addis Ababa"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-park">Preferred park</Label>
            <Input
              id="profile-park"
              placeholder="Unity Park"
              value={preferredPark}
              onChange={(e) => setPreferredPark(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        {localError && (
          <p className="text-sm text-destructive">{localError}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditProfileDialog;
