/**
 * ============================================================================
 * MODULE: components/LicenseControlPanel.tsx — Licensing & Remote Admin Panel
 * ----------------------------------------------------------------------------
 * Embedded inside Settings for administrators. Two responsibilities:
 *   - SOFTWARE LICENSE: view status/expiry and activate or renew the license
 *     on a monthly, quarterly, semi-annual, or annual billing cycle (and
 *     suspend it if needed).
 *   - ADMIN CONTROL CENTER: remotely govern the deployment by toggling
 *     maintenance mode, locking the system, enabling/disabling individual
 *     modules, broadcasting an announcement, and forcing logout of non-admin
 *     sessions. Changes propagate to other open tabs.
 * Non-admin users see a read-only view.
 * ============================================================================
 */
import { useState } from 'react';
import {
  AdminControlState,
  ControlledModule,
  LicenseBillingCycle,
  SoftwareLicense,
  User
} from '../types';
import { CheckCircle, KeyRound, LockKeyhole, Megaphone, Power, RefreshCw, ShieldCheck } from 'lucide-react';

interface LicenseControlPanelProps {
  license: SoftwareLicense;
  control: AdminControlState;
  currentUser: User | null;
  onActivateLicense: (cycle: LicenseBillingCycle, key: string) => void;
  onUpdateControl: (control: AdminControlState) => void;
  onSuspendLicense: () => void;
}

const MODULES: { id: ControlledModule; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'pos', label: 'POS Sales' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'crm', label: 'CRM' },
  { id: 'accounting', label: 'Accounting' },
  { id: 'payroll', label: 'Payroll' },
  { id: 'cashup', label: 'Cash Up' },
  { id: 'ai', label: 'AI Agent' }
];

export default function LicenseControlPanel({
  license,
  control,
  currentUser,
  onActivateLicense,
  onUpdateControl,
  onSuspendLicense
}: LicenseControlPanelProps) {
  const [cycle, setCycle] = useState<LicenseBillingCycle>(license.billingCycle);
  const [licenseKey, setLicenseKey] = useState(license.licenseKey);
  const [announcement, setAnnouncement] = useState(control.announcement);
  const isAdmin = currentUser?.userType === 'ADMIN';
  const isExpired = new Date(license.expiresAt).getTime() <= Date.now();

  /** Adds or removes one module from the central disabled-module list. */
  const toggleModule = (module: ControlledModule) => {
    if (!isAdmin) return;
    const disabledModules = control.disabledModules.includes(module)
      ? control.disabledModules.filter(item => item !== module)
      : [...control.disabledModules, module];
    onUpdateControl({ ...control, disabledModules });
  };

  return (
    <section className="mx-auto mt-8 max-w-5xl border-t border-gray-200 pt-8">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-gray-800">
          <ShieldCheck size={17} className="text-teal-600" /> Afritecx Badboy Licensing & Admin Control
        </h2>
        <p className="mt-1 text-xs text-gray-400">
          Manage renewal periods and centrally control this deployment. Controls synchronize across open tabs on the same hosted installation.
        </p>
      </div>

      {!isAdmin && (
        <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          Read-only license audit. Only administrators can change license or control settings.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-2xl border border-gray-100 bg-gray-50 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-teal-700">
                <KeyRound size={14} /> Software License
              </h3>
              <p className="mt-1 text-[10px] text-gray-400">Licensed to {license.licensedTo}</p>
            </div>
            <span className={`rounded px-2 py-1 text-[9px] font-black ${
              license.status === 'ACTIVE' && !isExpired
                ? 'bg-teal-100 text-teal-800'
                : 'bg-red-100 text-red-700'
            }`}>
              {isExpired ? 'EXPIRED' : license.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-white p-3">
              <span className="block text-[9px] font-bold uppercase text-gray-400">Billing period</span>
              <span className="font-bold text-gray-800">{license.billingCycle.replace('_', ' ')}</span>
            </div>
            <div className="rounded-xl bg-white p-3">
              <span className="block text-[9px] font-bold uppercase text-gray-400">Expires</span>
              <span className="font-mono font-bold text-gray-800">{new Date(license.expiresAt).toLocaleDateString()}</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase text-gray-500">License key</label>
            <input
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              disabled={!isAdmin}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-mono disabled:bg-gray-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase text-gray-500">Renewal cycle</label>
            <select
              value={cycle}
              onChange={(event) => setCycle(event.target.value as LicenseBillingCycle)}
              disabled={!isAdmin}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold disabled:bg-gray-100"
            >
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="SEMI_ANNUAL">Semi-annually</option>
              <option value="ANNUAL">Annually</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!isAdmin}
              onClick={() => onActivateLicense(cycle, licenseKey)}
              className="flex-1 rounded-xl bg-teal-600 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-200"
            >
              Activate / Renew
            </button>
            <button
              type="button"
              disabled={!isAdmin}
              onClick={onSuspendLicense}
              className="rounded-xl border border-red-200 bg-white px-3 py-2.5 text-xs font-bold text-red-600 disabled:cursor-not-allowed disabled:text-gray-300"
            >
              Suspend
            </button>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-gray-100 bg-white p-5">
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-teal-700">
            <LockKeyhole size={14} /> Administrator Control Center
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={!isAdmin}
              onClick={() => onUpdateControl({ ...control, maintenanceMode: !control.maintenanceMode })}
              className={`rounded-xl border p-3 text-left text-xs font-bold ${
                control.maintenanceMode ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-200 bg-gray-50 text-gray-700'
              }`}
            >
              <RefreshCw size={15} className="mb-1" /> Maintenance {control.maintenanceMode ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              disabled={!isAdmin}
              onClick={() => onUpdateControl({ ...control, systemLocked: !control.systemLocked })}
              className={`rounded-xl border p-3 text-left text-xs font-bold ${
                control.systemLocked ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-gray-50 text-gray-700'
              }`}
            >
              <Power size={15} className="mb-1" /> System {control.systemLocked ? 'Locked' : 'Open'}
            </button>
          </div>

          <div>
            <span className="mb-2 block text-[10px] font-bold uppercase text-gray-500">Module access</span>
            <div className="grid grid-cols-2 gap-2">
              {MODULES.map(module => {
                const disabled = control.disabledModules.includes(module.id);
                return (
                  <button
                    type="button"
                    disabled={!isAdmin}
                    key={module.id}
                    onClick={() => toggleModule(module.id)}
                    className={`rounded-lg border px-2 py-2 text-left text-[10px] font-bold ${
                      disabled ? 'border-red-100 bg-red-50 text-red-600' : 'border-teal-100 bg-teal-50 text-teal-700'
                    }`}
                  >
                    {module.label}: {disabled ? 'Disabled' : 'Enabled'}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase text-gray-500">
              <Megaphone size={12} /> User announcement
            </label>
            <textarea
              value={announcement}
              onChange={(event) => setAnnouncement(event.target.value)}
              disabled={!isAdmin}
              rows={2}
              className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs disabled:bg-gray-100"
              placeholder="Broadcast a message to all active users..."
            />
            <button
              type="button"
              disabled={!isAdmin}
              onClick={() => onUpdateControl({ ...control, announcement })}
              className="mt-2 w-full rounded-xl bg-slate-800 py-2 text-xs font-bold text-white disabled:bg-gray-200"
            >
              Publish Announcement
            </button>
          </div>

          <button
            type="button"
            disabled={!isAdmin}
            onClick={() => onUpdateControl({ ...control, forceLogoutToken: Date.now() })}
            className="w-full rounded-xl border border-amber-200 bg-amber-50 py-2.5 text-xs font-bold text-amber-800 disabled:bg-gray-100 disabled:text-gray-300"
          >
            Force Logout All Non-Admin Sessions
          </button>

          <p className="flex items-center gap-1 text-[9px] text-gray-400">
            <CheckCircle size={11} /> Last control update: {new Date(control.updatedAt).toLocaleString()}
          </p>
        </div>
      </div>
    </section>
  );
}