import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield,
  LogOut,
  CheckCircle2,
  Edit3,
  Save,
  X,
  User,
  Phone,
  MapPin,
  Train,
  AlertCircle,
  CreditCard,
  Ticket,
  Info,
  Clock
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useAuth } from '@/context/AuthContext';

export function Profile() {
  const { user: authUser, getProfile, updateProfile, logout } = useAuth();
  const navigate = useNavigate();

  const [profileData, setProfileData] = useState(authUser);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', message: string }

  // Form State
  const [formValues, setFormValues] = useState({
    name: '',
    phone: '',
    gender: '',
    date_of_birth: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    id_type: 'Aadhaar Card',
    id_number: '',
    preferred_class: 'No Preference',
    berth_preference: 'No Preference',
    food_preference: 'No Preference',
  });

  const initForm = (user) => {
    if (!user) return;
    setFormValues({
      name: user.name || user.full_name || '',
      phone: user.phone || '',
      gender: user.gender || '',
      date_of_birth: user.date_of_birth || user.dob || '',
      emergency_contact_name: user.emergency_contact_name || '',
      emergency_contact_phone: user.emergency_contact_phone || '',
      address: user.address || '',
      city: user.city || '',
      state: user.state || '',
      pincode: user.pincode || '',
      id_type: user.id_type || 'Aadhaar Card',
      id_number: user.id_number || '',
      preferred_class: user.preferred_class || user.coach_class_preference || 'No Preference',
      berth_preference: user.berth_preference || 'No Preference',
      food_preference: user.food_preference || 'No Preference',
    });
  };

  useEffect(() => {
    let isMounted = true;
    async function loadFreshProfile() {
      try {
        const res = await getProfile();
        if (isMounted && res && res.user) {
          setProfileData(res.user);
          initForm(res.user);
        }
      } catch (err) {
        console.warn('Could not fetch fresh profile from server, using session data:', err);
        if (isMounted && authUser) {
          initForm(authUser);
        }
      }
    }
    loadFreshProfile();
    return () => {
      isMounted = false;
    };
  }, []);

  const currentUser = profileData || authUser;
  const displayName = currentUser?.name || currentUser?.full_name || 'Passenger';
  const displayEmail = currentUser?.email || 'user@yatrio.com';
  const rawPhone = currentUser?.phone || '';
  const displayPhone = rawPhone
    ? rawPhone.startsWith('+91')
      ? rawPhone
      : `+91 ${rawPhone}`
    : '+91 98765 43210';
  const avatarInitial = displayName.trim().charAt(0).toUpperCase() || 'P';

  const handleStartEdit = () => {
    initForm(currentUser);
    setFeedback(null);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    initForm(currentUser);
    setFeedback(null);
    setIsEditing(false);
  };

  const handleSignOut = () => {
    logout();
    navigate('/');
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    setFeedback(null);

    const trimmedName = formValues.name.trim();
    if (trimmedName.length < 2) {
      setFeedback({ type: 'error', message: 'Full Name must contain at least 2 characters.' });
      return;
    }

    const trimmedPhone = formValues.phone.trim().replace(/^\+91\s*/, '');
    if (!/^[0-9]{10}$/.test(trimmedPhone)) {
      setFeedback({ type: 'error', message: 'Primary mobile number must contain exactly 10 digits.' });
      return;
    }

    const trimmedEmergencyPhone = formValues.emergency_contact_phone.trim().replace(/^\+91\s*/, '');
    if (trimmedEmergencyPhone.length > 0 && !/^[0-9]{10}$/.test(trimmedEmergencyPhone)) {
      setFeedback({ type: 'error', message: 'Emergency contact phone must contain exactly 10 digits.' });
      return;
    }

    const trimmedPincode = formValues.pincode.trim();
    if (trimmedPincode.length > 0 && !/^[0-9]{6}$/.test(trimmedPincode)) {
      setFeedback({ type: 'error', message: 'PIN code must contain exactly 6 digits.' });
      return;
    }

    setIsSaving(true);

    try {
      const payload = {
        name: trimmedName,
        full_name: trimmedName,
        phone: trimmedPhone,
        gender: formValues.gender || null,
        date_of_birth: formValues.date_of_birth || null,
        emergency_contact_name: formValues.emergency_contact_name.trim() || null,
        emergency_contact_phone: trimmedEmergencyPhone || null,
        address: formValues.address.trim() || null,
        city: formValues.city.trim() || null,
        state: formValues.state.trim() || null,
        pincode: trimmedPincode || null,
        id_type: formValues.id_type || null,
        id_number: formValues.id_number.trim() || null,
        preferred_class: formValues.preferred_class,
        berth_preference: formValues.berth_preference,
        food_preference: formValues.food_preference,
      };

      const res = await updateProfile(payload);
      if (res && res.user) {
        setProfileData(res.user);
        initForm(res.user);
      }
      setIsEditing(false);
      setFeedback({ type: 'success', message: 'Profile updated successfully! All changes have been persisted.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update profile.' });
    } finally {
      setIsSaving(false);
    }
  };

  const maskedIdNumber = currentUser?.id_number
    ? `•••• •••• ${currentUser.id_number.slice(-4)}`
    : 'Not linked yet';

  return (
    <div className="min-h-screen bg-fog/20 py-10 px-4 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Page Title */}
        <div>
          <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-royal">
            User Account
          </span>
          <h1 className="text-h2 font-bold tracking-tight text-ink mt-0.5">
            Passenger Profile
          </h1>
          <p className="text-body text-ink-soft mt-1">
            Manage your personal contact details, verified government ID links, and travel preferences.
          </p>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`p-4 rounded-control text-sm font-medium flex items-center justify-between gap-3 shadow-sm ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border border-emerald-300'
                : 'bg-red-50 text-red-900 border border-red-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="size-5 text-red-600 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-ink-soft hover:text-ink text-xs font-semibold underline cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Profile Banner */}
        <Card className="p-0 overflow-hidden border-line-mid shadow-card rounded-card">
          <div className="bg-gradient-to-r from-navy via-royal to-azure text-paper p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex flex-col sm:flex-row items-center gap-5 text-center sm:text-left">
              <div className="size-20 rounded-full bg-white/25 border-2 border-white/60 flex items-center justify-center text-3xl font-black text-paper shadow-raised shrink-0">
                {avatarInitial}
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <h2 className="text-h3 font-bold text-paper" id="profile-display-name">
                    {displayName}
                  </h2>
                  <Badge
                    variant="outline"
                    className="border-white/40 text-paper font-semibold bg-white/15"
                  >
                    Passenger Account
                  </Badge>
                </div>
                <p className="text-caption text-paper/90 font-medium" id="profile-display-email">
                  {displayEmail}
                </p>
                <div className="flex items-center justify-center sm:justify-start gap-3 text-xs text-paper/80 pt-1">
                  <span id="profile-display-phone">{displayPhone}</span>
                  <span>•</span>
                  <span>Yatrio Member</span>
                </div>
              </div>
            </div>

            {/* Header Action Buttons — High Contrast, Fully Visible */}
            <div className="flex flex-wrap items-center justify-center md:justify-end gap-2.5 sm:gap-3 shrink-0">
              {!isEditing ? (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  id="edit-profile-btn"
                  className="inline-flex items-center justify-center gap-2 rounded-control bg-white px-4 py-2 text-sm font-bold text-navy shadow-raised hover:bg-paper hover:text-royal hover:shadow-pop transition-all active:translate-y-px cursor-pointer"
                >
                  <Edit3 className="size-4 text-royal" /> Edit Profile
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    id="save-profile-header-btn"
                    className="inline-flex items-center justify-center gap-2 rounded-control bg-emerald-500 hover:bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-raised transition-all active:translate-y-px cursor-pointer disabled:opacity-50"
                  >
                    <Save className="size-4" /> {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    disabled={isSaving}
                    id="cancel-edit-header-btn"
                    className="inline-flex items-center justify-center gap-2 rounded-control bg-white/20 border border-white/80 hover:bg-white/30 px-3.5 py-2 text-sm font-bold text-white shadow-sm transition-all active:translate-y-px cursor-pointer"
                  >
                    <X className="size-4" /> Cancel
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={handleSignOut}
                id="sign-out-btn"
                className="inline-flex items-center justify-center gap-2 rounded-control bg-white/10 border border-white/70 hover:bg-white hover:text-navy px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-all active:translate-y-px cursor-pointer"
              >
                <LogOut className="size-4" /> Sign Out
              </button>
            </div>
          </div>

          {/* Card Body */}
          <div className="p-6 md:p-8 bg-white space-y-8">
            <form onSubmit={handleSave} className="space-y-8">
              {/* Section 1: Personal Information */}
              <div className="space-y-4">
                <div className="border-b border-line pb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="size-4 text-royal" />
                    <h3 className="text-h4 font-bold text-ink">Personal Information</h3>
                  </div>
                  {isEditing && (
                    <span className="text-xs text-ink-soft">* Indicates required field</span>
                  )}
                </div>

                {isEditing ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Full Name *"
                      id="input-full-name"
                      value={formValues.name}
                      onChange={(e) => setFormValues({ ...formValues, name: e.target.value })}
                      placeholder="e.g. Rahul Sharma"
                      required
                    />

                    <div>
                      <Input
                        label="Registered Email"
                        id="input-email"
                        value={displayEmail}
                        disabled
                        helperText="Login email is managed via account credentials"
                      />
                    </div>

                    <Input
                      label="Primary Phone *"
                      id="input-phone"
                      value={formValues.phone}
                      onChange={(e) => setFormValues({ ...formValues, phone: e.target.value })}
                      placeholder="10-digit mobile number"
                      required
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <Select
                        label="Gender"
                        id="input-gender"
                        value={formValues.gender}
                        onChange={(e) => setFormValues({ ...formValues, gender: e.target.value })}
                        options={[
                          { label: 'Select Gender', value: '' },
                          { label: 'Male', value: 'Male' },
                          { label: 'Female', value: 'Female' },
                          { label: 'Transgender', value: 'Transgender' },
                          { label: 'Other', value: 'Other' },
                        ]}
                      />

                      <Input
                        label="Date of Birth"
                        id="input-dob"
                        type="date"
                        value={formValues.date_of_birth}
                        onChange={(e) => setFormValues({ ...formValues, date_of_birth: e.target.value })}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                        Full Name
                      </span>
                      <span className="font-semibold text-ink mt-0.5 block">{displayName}</span>
                    </div>
                    <div>
                      <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                        Registered Email
                      </span>
                      <span className="font-semibold text-ink mt-0.5 block">{displayEmail}</span>
                    </div>
                    <div>
                      <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                        Primary Phone
                      </span>
                      <span className="font-semibold text-ink mt-0.5 block">{displayPhone}</span>
                    </div>
                    <div>
                      <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                        Gender / DOB
                      </span>
                      <span className="font-medium text-ink mt-0.5 block">
                        {currentUser?.gender || '—'} {currentUser?.date_of_birth ? `• ${currentUser.date_of_birth}` : ''}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 2: Residential Address & Emergency Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
                {/* Residential Address */}
                <div className="space-y-4">
                  <div className="border-b border-line pb-2 flex items-center gap-2">
                    <MapPin className="size-4 text-royal" />
                    <h3 className="text-h4 font-bold text-ink">Residential Address</h3>
                  </div>

                  {isEditing ? (
                    <div className="space-y-3">
                      <Input
                        label="Street / House Address"
                        id="input-address"
                        value={formValues.address}
                        onChange={(e) => setFormValues({ ...formValues, address: e.target.value })}
                        placeholder="Street address, apartment, locality"
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          label="City"
                          id="input-city"
                          value={formValues.city}
                          onChange={(e) => setFormValues({ ...formValues, city: e.target.value })}
                          placeholder="City"
                        />
                        <Input
                          label="State"
                          id="input-state"
                          value={formValues.state}
                          onChange={(e) => setFormValues({ ...formValues, state: e.target.value })}
                          placeholder="State"
                        />
                        <Input
                          label="PIN Code"
                          id="input-pincode"
                          value={formValues.pincode}
                          onChange={(e) => setFormValues({ ...formValues, pincode: e.target.value })}
                          placeholder="6 digits"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                          Street Address
                        </span>
                        <span className="font-medium text-ink mt-0.5 block">
                          {currentUser?.address || 'Not specified'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <div>
                          <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                            City
                          </span>
                          <span className="font-medium text-ink mt-0.5 block">{currentUser?.city || '—'}</span>
                        </div>
                        <div>
                          <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                            State
                          </span>
                          <span className="font-medium text-ink mt-0.5 block">{currentUser?.state || '—'}</span>
                        </div>
                        <div>
                          <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                            PIN Code
                          </span>
                          <span className="font-medium text-ink mt-0.5 block">{currentUser?.pincode || '—'}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Emergency Details */}
                <div className="space-y-4">
                  <div className="border-b border-line pb-2 flex items-center gap-2">
                    <Phone className="size-4 text-royal" />
                    <h3 className="text-h4 font-bold text-ink">Emergency Contact</h3>
                  </div>

                  {isEditing ? (
                    <div className="space-y-3">
                      <Input
                        label="Emergency Contact Name"
                        id="input-emergency-name"
                        value={formValues.emergency_contact_name}
                        onChange={(e) => setFormValues({ ...formValues, emergency_contact_name: e.target.value })}
                        placeholder="e.g. Next of Kin or Guardian"
                      />
                      <Input
                        label="Emergency Contact Phone"
                        id="input-emergency-phone"
                        value={formValues.emergency_contact_phone}
                        onChange={(e) => setFormValues({ ...formValues, emergency_contact_phone: e.target.value })}
                        placeholder="10-digit emergency contact phone"
                      />
                    </div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                          Emergency Contact Name
                        </span>
                        <span className="font-medium text-ink mt-0.5 block">
                          {currentUser?.emergency_contact_name || 'Not provided'}
                        </span>
                      </div>
                      <div>
                        <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                          Emergency Contact Phone
                        </span>
                        <span className="font-medium text-ink mt-0.5 block">
                          {currentUser?.emergency_contact_phone
                            ? `+91 ${currentUser.emergency_contact_phone}`
                            : 'Not provided'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Section 3: Travel Preferences */}
              <div className="space-y-4 pt-2">
                <div className="border-b border-line pb-2 flex items-center gap-2">
                  <Train className="size-4 text-royal" />
                  <h3 className="text-h4 font-bold text-ink">Travel Preferences</h3>
                </div>

                {isEditing ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Select
                      label="Preferred Coach Class"
                      id="input-preferred-class"
                      value={formValues.preferred_class}
                      onChange={(e) => setFormValues({ ...formValues, preferred_class: e.target.value })}
                      options={[
                        { label: 'No Preference', value: 'No Preference' },
                        { label: 'SL - Sleeper Class', value: 'SL' },
                        { label: '3A - AC 3 Tier', value: '3A' },
                        { label: '2A - AC 2 Tier', value: '2A' },
                        { label: '1A - AC First Class', value: '1A' },
                        { label: 'CC - AC Chair Car', value: 'CC' },
                        { label: 'EC - Exec Chair Car', value: 'EC' },
                      ]}
                    />

                    <Select
                      label="Preferred Berth"
                      id="input-berth-preference"
                      value={formValues.berth_preference}
                      onChange={(e) => setFormValues({ ...formValues, berth_preference: e.target.value })}
                      options={[
                        { label: 'No Preference', value: 'No Preference' },
                        { label: 'Lower Berth', value: 'Lower' },
                        { label: 'Middle Berth', value: 'Middle' },
                        { label: 'Upper Berth', value: 'Upper' },
                        { label: 'Side Lower Berth', value: 'Side Lower' },
                        { label: 'Side Upper Berth', value: 'Side Upper' },
                      ]}
                    />

                    <Select
                      label="Meal Preference"
                      id="input-food-preference"
                      value={formValues.food_preference}
                      onChange={(e) => setFormValues({ ...formValues, food_preference: e.target.value })}
                      options={[
                        { label: 'No Preference', value: 'No Preference' },
                        { label: 'Vegetarian', value: 'Vegetarian' },
                        { label: 'Non-vegetarian', value: 'Non-vegetarian' },
                        { label: 'Jain Meal', value: 'Jain' },
                        { label: 'Vegan', value: 'Vegan' },
                      ]}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                        Preferred Coach Class
                      </span>
                      <span className="font-semibold text-ink mt-0.5 block">
                        {currentUser?.preferred_class || currentUser?.coach_class_preference || 'No Preference'}
                      </span>
                    </div>
                    <div>
                      <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                        Preferred Berth
                      </span>
                      <span className="font-semibold text-ink mt-0.5 block">
                        {currentUser?.berth_preference || 'No Preference'}
                      </span>
                    </div>
                    <div>
                      <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                        Meal Preference
                      </span>
                      <span className="font-semibold text-ink mt-0.5 block">
                        {currentUser?.food_preference || 'No Preference'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Clear disclaimer on travel preferences */}
                <div className="flex items-start gap-2.5 p-3 rounded-control bg-azure/5 border border-azure/20 text-xs text-ink-soft">
                  <Info className="size-4 text-royal shrink-0 mt-0.5" />
                  <span>
                    Preferences are requests communicated to the railway reservation system. Specific coach, berth, or meal allocations depend on train chart preparation and cannot be guaranteed.
                  </span>
                </div>
              </div>

              {/* Section 4: Identity & Verification (Backed by Real Data) */}
              <div className="space-y-4 pt-2">
                <div className="border-b border-line pb-2 flex items-center gap-2">
                  <CreditCard className="size-4 text-royal" />
                  <h3 className="text-h4 font-bold text-ink">Identity & Verification</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Government ID */}
                  <div className="p-4 rounded-control bg-fog/30 border border-line space-y-3">
                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                      Government ID Link
                    </span>

                    {isEditing ? (
                      <div className="space-y-3">
                        <Select
                          label="ID Type"
                          id="input-id-type"
                          value={formValues.id_type}
                          onChange={(e) => setFormValues({ ...formValues, id_type: e.target.value })}
                          options={[
                            { label: 'Aadhaar Card', value: 'Aadhaar Card' },
                            { label: 'PAN Card', value: 'PAN Card' },
                            { label: 'Passport', value: 'Passport' },
                            { label: 'Voter ID', value: 'Voter ID' },
                            { label: 'Driving License', value: 'Driving License' },
                          ]}
                        />
                        <Input
                          label="ID Number"
                          id="input-id-number"
                          value={formValues.id_number}
                          onChange={(e) => setFormValues({ ...formValues, id_number: e.target.value })}
                          placeholder="Enter government ID number"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-ink block text-sm">
                            {currentUser?.id_type || 'Aadhaar Card'}
                          </span>
                          <span className="text-caption text-ink-soft block mt-0.5">
                            {maskedIdNumber}
                          </span>
                        </div>
                        {currentUser?.id_number && (
                          <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-semibold">
                            Linked on Record
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Account Verification Status */}
                  <div className="p-4 rounded-control bg-fog/30 border border-line space-y-3">
                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                      Verification Status
                    </span>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        {currentUser?.is_email_verified ? (
                          <>
                            <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                            <span className="font-medium text-ink">Email Verified (Login Secured)</span>
                          </>
                        ) : (
                          <>
                            <Clock className="size-4 text-amber-600 shrink-0" />
                            <span className="font-medium text-ink">Email Pending Verification</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {currentUser?.phone ? (
                          <>
                            <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                            <span className="font-medium text-ink">Mobile Linked for IRCTC OTP</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="size-4 text-amber-600 shrink-0" />
                            <span className="font-medium text-ink">Mobile Not Linked</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 5: Account & Journey Information (Real Data Links) */}
              <div className="space-y-4 pt-2">
                <div className="border-b border-line pb-2 flex items-center gap-2">
                  <Ticket className="size-4 text-royal" />
                  <h3 className="text-h4 font-bold text-ink">Account & Booking Information</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Bookings & Journeys Tile */}
                  <div className="p-4 rounded-control border border-line bg-white flex flex-col justify-between gap-3 shadow-sm">
                    <div>
                      <h4 className="font-bold text-ink text-sm">Upcoming Journeys & PNR Status</h4>
                      <p className="text-caption text-ink-soft mt-1">
                        View current reservations, train schedules, coach seat allocations, and downloaded e-tickets.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate('/my-bookings')}
                      className="self-start gap-1.5"
                    >
                      <Ticket className="size-3.5" /> View My Bookings
                    </Button>
                  </div>

                  {/* Payments & Refunds Tile */}
                  <div className="p-4 rounded-control border border-line bg-white flex flex-col justify-between gap-3 shadow-sm">
                    <div>
                      <h4 className="font-bold text-ink text-sm">Payments & Refund History</h4>
                      <p className="text-caption text-ink-soft mt-1">
                        Track past transaction orders, Razorpay payment verification references, and processed refunds.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate('/payments')}
                      className="self-start gap-1.5"
                    >
                      <CreditCard className="size-3.5" /> View Payment History
                    </Button>
                  </div>
                </div>
              </div>

              {/* Section 6: Account Security & Privacy */}
              <div className="space-y-4 pt-2">
                <div className="border-b border-line pb-2 flex items-center gap-2">
                  <Shield className="size-4 text-royal" />
                  <h3 className="text-h4 font-bold text-ink">Account Security & Privacy</h3>
                </div>

                <div className="p-4 rounded-control border border-line bg-fog/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-sm">
                  <div className="space-y-1">
                    <span className="font-semibold text-ink block">Session & Account Privacy</span>
                    <span className="text-caption text-ink-soft block">
                      Active passenger session is secured using token-based JWT authentication. Password resets and credentials are authenticated directly by the platform security layer.
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSignOut}
                    className="shrink-0 gap-1.5"
                  >
                    <LogOut className="size-3.5" /> Sign Out
                  </Button>
                </div>
              </div>

              {/* Bottom Action Bar in Edit Mode */}
              {isEditing && (
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-line">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancelEdit}
                    disabled={isSaving}
                    id="cancel-bottom-btn"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isSaving}
                    className="gap-2"
                    id="save-bottom-btn"
                  >
                    <Save className="size-4" /> {isSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
}
