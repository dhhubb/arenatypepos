/**
 * ============================================================================
 * MODULE: components/PayrollView.tsx — Payroll & Workforce Management
 * ----------------------------------------------------------------------------
 * Handles paying staff and related tax. Responsibilities:
 *   - EMPLOYEES: maintain staff records (hourly or salaried, tax rate, etc.).
 *   - TIMESHEETS: review and approve/reject submitted work hours.
 *   - PAY RUNS: calculate gross pay, tax withheld, and net pay, then process a
 *     pay run that posts wage expense and payment journals via App.tsx.
 *   - TAX REMITTANCE: record payments of withheld tax to the authorities.
 *   - PAYSLIPS: generate printable payslips for each employee in a run.
 * Amounts display in the configured currency; AUDIT users cannot process pay.
 * ============================================================================
 */
import React, { useState } from 'react';
import { Employee, Payrun, PayrunItem, BusinessProfile, PayType, Timesheet, TaxRemittance, User } from '../types';
import { 
  Users, 
  Calendar, 
  Plus, 
  CheckCircle, 
  AlertCircle, 
  Briefcase, 
  FileText, 
  Printer, 
  Mail, 
  ShieldCheck,
  CreditCard,
  Check,
  X
} from 'lucide-react';

interface PayrollViewProps {
  employees: Employee[];
  payruns: Payrun[];
  businessProfile: BusinessProfile;
  onAddEmployee: (employee: Employee) => void;
  onRunPayroll: (payrun: Payrun) => void;
  timesheets: Timesheet[];
  onUpdateTimesheetStatus: (id: string, status: 'APPROVED' | 'REJECTED') => void;
  taxRemittances: TaxRemittance[];
  onRemitTax: (amount: number, method: 'CASH' | 'CARD', quarter: string) => void;
  currentUser: User | null;
}

type SubTab = 'employees' | 'timesheets' | 'run' | 'history' | 'remit';

export default function PayrollView({
  employees,
  payruns,
  businessProfile,
  onAddEmployee,
  onRunPayroll,
  timesheets,
  onUpdateTimesheetStatus,
  taxRemittances,
  onRemitTax,
  currentUser
}: PayrollViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('employees');

  // Add Employee Form State
  const [isAddEmpOpen, setIsAddEmpOpen] = useState(false);
  const [empName, setEmpName] = useState('');
  const [empRole, setEmpRole] = useState('');
  const [empPayType, setEmpPayType] = useState<PayType>('HOURLY');
  const [empRate, setEmpRate] = useState('');
  const [empTaxRate, setEmpTaxRate] = useState('15');
  const [empEmail, setEmpEmail] = useState('');
  const [empTaxId, setEmpTaxId] = useState('');

  // Run Payroll Form State
  const [runStartDate, setRunStartDate] = useState(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]); // 2 weeks ago
  const [runEndDate, setRunEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [runPaymentMethod, setRunPaymentMethod] = useState<'CASH' | 'CARD'>('CARD');
  const [hourlyHours, setHourlyHours] = useState<{ [employeeId: string]: string }>({});
  const [payrollSuccess, setPayrollSuccess] = useState(false);
  const [payrollError, setPayrollError] = useState('');

  // Selected Payslip Modal
  const [selectedPayslip, setSelectedPayslip] = useState<{ payrun: Payrun; item: PayrunItem } | null>(null);

  // Active Employees
  const activeEmployees = employees.filter(e => e.isActive);

  // Handle Create Employee
  const handleCreateEmployeeSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (currentUser?.userType === 'AUDIT') {
      alert('Security Warning: This is a Read-Only Audit session. Staff profile registrations are locked.');
      return;
    }

    if (!empName.trim() || !empRole.trim() || !empRate.trim()) {
      alert('Please fill out all required fields.');
      return;
    }

    const newEmp: Employee = {
      id: `emp-${Date.now()}`,
      name: empName.trim(),
      role: empRole.trim(),
      payType: empPayType,
      payRate: parseFloat(empRate) || 0,
      taxWithholdingRate: parseFloat(empTaxRate) || 0,
      email: empEmail.trim(),
      taxId: empTaxId.trim() || `TFN-${Math.floor(100000 + Math.random() * 900000)}`,
      isActive: true
    };

    onAddEmployee(newEmp);
    setIsAddEmpOpen(false);

    // reset fields
    setEmpName('');
    setEmpRole('');
    setEmpRate('');
    setEmpTaxRate('15');
    setEmpEmail('');
    setEmpTaxId('');
  };

  // Live calculation of current Payrun items
  const currentPayrunItems: PayrunItem[] = activeEmployees.map(emp => {
    let hours = 160; // default salaried hours
    if (emp.payType === 'HOURLY') {
      hours = parseFloat(hourlyHours[emp.id]) || 0;
    }

    const grossPay = emp.payType === 'HOURLY' ? emp.payRate * hours : emp.payRate;
    const taxWithheld = grossPay * (emp.taxWithholdingRate / 100);
    const netPay = grossPay - taxWithheld;

    return {
      employeeId: emp.id,
      employeeName: emp.name,
      payType: emp.payType,
      payRate: emp.payRate,
      hoursWorked: hours,
      grossPay: parseFloat(grossPay.toFixed(2)),
      taxWithheld: parseFloat(taxWithheld.toFixed(2)),
      netPay: parseFloat(netPay.toFixed(2))
    };
  });

  const runTotalGross = currentPayrunItems.reduce((sum, item) => sum + item.grossPay, 0);
  const runTotalTax = currentPayrunItems.reduce((sum, item) => sum + item.taxWithheld, 0);
  const runTotalNet = currentPayrunItems.reduce((sum, item) => sum + item.netPay, 0);

  // Submit and disburse payroll
  const handleSubmitPayrun = (e: React.FormEvent) => {
    e.preventDefault();
    setPayrollError('');
    setPayrollSuccess(false);

    if (currentUser?.userType === 'AUDIT') {
      setPayrollError('Security Warning: This is a Read-Only Audit session. Releasing wages and processing payruns are locked.');
      return;
    }

    // Check hourly hours filled
    const missingHours = activeEmployees.some(emp => emp.payType === 'HOURLY' && (!hourlyHours[emp.id] || parseFloat(hourlyHours[emp.id]) <= 0));
    if (missingHours) {
      setPayrollError('Please enter positive hours worked for all hourly employees.');
      return;
    }

    if (currentPayrunItems.length === 0) {
      setPayrollError('No active employees found to disburse payroll.');
      return;
    }

    const payrunId = `PR-${Date.now()}`;
    const payrunNo = `PR-${Math.floor(1000 + Math.random() * 9000)}`;

    const newPayrun: Payrun = {
      id: payrunId,
      payrunNo,
      startDate: runStartDate,
      endDate: runEndDate,
      paymentDate: new Date().toISOString().split('T')[0],
      totalGross: parseFloat(runTotalGross.toFixed(2)),
      totalTax: parseFloat(runTotalTax.toFixed(2)),
      totalNet: parseFloat(runTotalNet.toFixed(2)),
      paymentMethod: runPaymentMethod,
      items: currentPayrunItems
    };

    onRunPayroll(newPayrun);
    setPayrollSuccess(true);
    setHourlyHours({});

    setTimeout(() => {
      setPayrollSuccess(false);
      setActiveSubTab('history');
    }, 1500);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-140px)] min-h-[500px]">
      
      {/* Sub Navigation header */}
      <div className="bg-gray-50 border-b border-gray-100 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <Users size={18} className="text-teal-600" /> Integrated Corporate Payroll
          </h2>
          <p className="text-xs text-gray-400 mt-0.5 font-medium">Process company wages, withhold income tax, and disburse pay slips with general ledger sync</p>
        </div>

        {/* Tab switchers */}
        <div className="flex bg-white border border-gray-200 rounded-xl p-1 gap-1 self-start overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveSubTab('employees')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeSubTab === 'employees'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Users size={14} /> Employee Directory
          </button>
          <button
            onClick={() => {
              // Pre-populate hourly hours based on APPROVED timesheets
              const prefilled: { [empId: string]: string } = {};
              employees.forEach(emp => {
                if (emp.payType === 'HOURLY') {
                  const approvedTS = timesheets.find(t => t.employeeId === emp.id && t.status === 'APPROVED');
                  prefilled[emp.id] = approvedTS ? approvedTS.hoursWorked.toString() : '40';
                }
              });
              setHourlyHours(prefilled);
              setActiveSubTab('run');
            }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeSubTab === 'run'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Calendar size={14} /> Process Payrun
          </button>
          <button
            onClick={() => setActiveSubTab('timesheets')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeSubTab === 'timesheets'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Calendar size={14} /> Timesheet Approvals
          </button>
          <button
            onClick={() => setActiveSubTab('history')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeSubTab === 'history'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <FileText size={14} /> Payslip Ledger Roll
          </button>
          <button
            onClick={() => setActiveSubTab('remit')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeSubTab === 'remit'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <ShieldCheck size={14} /> Tax Remittance
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        
        {/* ================= SUB-TAB 1: EMPLOYEES DIRECTORY ================= */}
        {activeSubTab === 'employees' && (
          <div className="space-y-6 animate-fade-in">
            
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Operational Personnel Register</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">Maintain salaries, hour benchmarks, and personal withholding matrices.</p>
              </div>
              <button
                onClick={() => setIsAddEmpOpen(true)}
                className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-3.5 rounded-xl text-xs flex items-center gap-1 shadow cursor-pointer transition-colors"
              >
                <Plus size={14} /> Onboard Employee
              </button>
            </div>

            {/* Employees Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {employees.map(emp => (
                <div key={emp.id} className="border border-gray-100 bg-gray-50/40 rounded-2xl p-4 flex flex-col justify-between gap-4 hover:border-gray-200 transition-all shadow-xs">
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-sm font-bold text-gray-800">{emp.name}</h4>
                        <span className="text-[10px] text-gray-400 font-semibold">{emp.role}</span>
                      </div>
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${emp.isActive ? 'bg-teal-100 text-teal-800' : 'bg-red-100 text-red-800'}`}>
                        {emp.isActive ? 'Active' : 'Suspended'}
                      </span>
                    </div>

                    <div className="space-y-1 text-xs text-gray-500 font-semibold pl-0.5">
                      <p className="flex items-center gap-1.5"><Mail size={12} className="text-gray-400" /> {emp.email}</p>
                      <p className="flex items-center gap-1.5"><Briefcase size={12} className="text-gray-400" /> Tax ID: <span className="font-mono">{emp.taxId}</span></p>
                    </div>
                  </div>

                  <div className="border-t border-gray-150/60 pt-3 flex items-center justify-between">
                    <div>
                      <span className="text-[8px] text-gray-400 uppercase font-black block">PAYRATE ({emp.payType})</span>
                      <span className="text-xs font-black text-teal-700 font-mono">
                        {businessProfile.currency}{emp.payRate.toFixed(2)}{emp.payType === 'HOURLY' ? '/hr' : '/mo'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[8px] text-gray-400 uppercase font-black block">TAX WITHHOLDING</span>
                      <span className="text-xs font-black text-amber-700 font-mono">
                        {emp.taxWithholdingRate}% Code PAYG
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

          </div>
        )}

        {/* ================= SUB-TAB 2: PROCESS PAYRUN ================= */}
        {activeSubTab === 'run' && (
          <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
            
            <form onSubmit={handleSubmitPayrun} className="bg-gray-50 border border-gray-100 rounded-2xl p-6 shadow-xs space-y-5">
              <div className="border-b border-gray-200 pb-3">
                <h3 className="text-sm font-bold text-gray-800 font-mono">Run Authorized Pay Cycle</h3>
                <p className="text-xs text-gray-400 mt-0.5 font-medium">Verify employee records and hours prior to releasing wages and publishing tax offsets.</p>
              </div>

              {/* Pay Cycle parameters */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Cycle Start Date</label>
                  <input
                    type="date"
                    required
                    value={runStartDate}
                    onChange={(e) => setRunStartDate(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Cycle End Date</label>
                  <input
                    type="date"
                    required
                    value={runEndDate}
                    onChange={(e) => setRunEndDate(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Disbursement Asset Account</label>
                  <select
                    value={runPaymentMethod}
                    onChange={(e) => setRunPaymentMethod(e.target.value as any)}
                    className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  >
                    <option value="CARD">Bank Checking Account (1020)</option>
                    <option value="CASH">Physical Cash Drawer (1010)</option>
                  </select>
                </div>
              </div>

              {/* Wage computation sheet table */}
              <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100 uppercase tracking-wide text-[10px]">
                        <th className="py-2.5 px-3">Employee Name / Role</th>
                        <th className="py-2.5 px-3">Pay Structure</th>
                        <th className="py-2.5 px-3 text-center w-36">Hours Input</th>
                        <th className="py-2.5 px-3 text-right">Gross Earnings</th>
                        <th className="py-2.5 px-3 text-right">Tax Withheld</th>
                        <th className="py-2.5 px-3 text-right">Net Take-home</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {currentPayrunItems.map((item) => {
                        const emp = activeEmployees.find(e => e.id === item.employeeId)!;
                        return (
                          <tr key={item.employeeId} className="hover:bg-gray-50/30">
                            <td className="py-3 px-3">
                              <h5 className="font-bold text-gray-800">{item.employeeName}</h5>
                              <p className="text-[10px] text-gray-400 font-medium">{emp.role}</p>
                            </td>
                            <td className="py-3 px-3 font-semibold text-gray-600">
                              {emp.payType === 'HOURLY' ? `${businessProfile.currency}${emp.payRate}/hr` : `${businessProfile.currency}${emp.payRate}/mo`}
                            </td>
                            <td className="py-3 px-3 text-center">
                              {emp.payType === 'HOURLY' ? (
                                <input
                                  type="number"
                                  placeholder="Hours"
                                  min="0"
                                  required
                                  value={hourlyHours[emp.id] || ''}
                                  onChange={(e) => setHourlyHours({ ...hourlyHours, [emp.id]: e.target.value })}
                                  className="bg-gray-50 border border-gray-200 rounded-lg py-1 px-2 text-center w-24 text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-teal-500"
                                />
                              ) : (
                                <span className="text-gray-400 italic text-[11px] font-semibold">Salaried (No Hours)</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-gray-700">{businessProfile.currency}{item.grossPay.toFixed(2)}</td>
                            <td className="py-3 px-3 text-right font-mono text-amber-700">-{businessProfile.currency}{item.taxWithheld.toFixed(2)}</td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-teal-600">{businessProfile.currency}{item.netPay.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Total Summary */}
              <div className="grid grid-cols-3 gap-4 bg-white border border-gray-100 p-4 rounded-xl shadow-xs">
                <div className="text-center">
                  <span className="text-[9px] text-gray-400 font-black block uppercase">Cumulative Gross Expenses</span>
                  <span className="text-sm font-black font-mono text-gray-800 mt-1 block">
                    {businessProfile.currency}{runTotalGross.toFixed(2)}
                  </span>
                </div>
                <div className="text-center">
                  <span className="text-[9px] text-amber-700 font-black block uppercase">Income Tax Withholdings</span>
                  <span className="text-sm font-black font-mono text-amber-700 mt-1 block">
                    {businessProfile.currency}{runTotalTax.toFixed(2)}
                  </span>
                </div>
                <div className="text-center bg-teal-50/40 border border-teal-100 rounded-lg py-1">
                  <span className="text-[9px] text-teal-800 font-black block uppercase">Net Liquid Outflow</span>
                  <span className="text-sm font-black font-mono text-teal-700 mt-1 block">
                    {businessProfile.currency}{runTotalNet.toFixed(2)}
                  </span>
                </div>
              </div>

              {payrollError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 p-3 rounded-xl font-bold flex items-center gap-1.5">
                  <AlertCircle size={15} /> {payrollError}
                </p>
              )}

              {payrollSuccess && (
                <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 p-3 rounded-xl font-bold flex items-center gap-1.5 animate-fade-in">
                  <CheckCircle size={15} /> Wage run authorized! Payments disbursed, tax reserves booked, and Wages Expense general ledger lines synced.
                </p>
              )}

              {/* Controls */}
              <div className="border-t border-gray-200 pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setHourlyHours({})}
                  className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2.5 rounded-xl text-xs"
                >
                  Clear Hours
                </button>
                <button
                  type="submit"
                  disabled={currentPayrunItems.length === 0}
                  className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 rounded-xl text-xs shadow cursor-pointer transition-colors"
                >
                  Approve & Release Payments
                </button>
              </div>

            </form>

          </div>
        )}

        {/* ================= SUB-TAB 3: PAYROLL LEDGER HISTORY ================= */}
        {activeSubTab === 'history' && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <h3 className="text-sm font-bold text-gray-800">Historical Payroll Registers</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">Chronological summary of all wage disbursements and associated income taxes.</p>
            </div>

            <div className="space-y-4">
              {payruns.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl p-12 text-center text-gray-400 italic">No payroll history found in memory.</div>
              ) : (
                [...payruns].reverse().map(run => (
                  <div key={run.id} className="border border-gray-100 bg-white rounded-2xl shadow-xs overflow-hidden">
                    <div className="p-4 bg-gray-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-gray-150/60 gap-3">
                      <div>
                        <span className="text-[9px] font-black uppercase tracking-wider bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded font-mono">Run #{run.payrunNo}</span>
                        <span className="text-xs text-gray-400 font-semibold font-mono ml-2">Paid on: {run.paymentDate}</span>
                        <h4 className="text-xs font-black text-gray-700 mt-1">Pay Period: <span className="font-mono">{run.startDate}</span> to <span className="font-mono">{run.endDate}</span></h4>
                      </div>
                      <div className="flex gap-4 items-center self-end sm:self-auto text-right">
                        <div>
                          <span className="text-[8px] text-gray-400 font-black block uppercase">TOTAL NET DISBURSED</span>
                          <span className="text-xs font-black font-mono text-teal-700">{businessProfile.currency}{run.totalNet.toFixed(2)}</span>
                        </div>
                        <div className="h-6 w-px bg-gray-200"></div>
                        <div>
                          <span className="text-[8px] text-gray-400 font-black block uppercase">TAX WITHHOLDINGS</span>
                          <span className="text-xs font-black font-mono text-amber-700">{businessProfile.currency}{run.totalTax.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3">
                      <div className="overflow-x-auto border border-gray-100 rounded-xl">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="bg-gray-50 text-gray-500 font-semibold">
                              <th className="py-2 px-3">Employee</th>
                              <th className="py-2 px-3 text-center">Structure / Hours</th>
                              <th className="py-2 px-3 text-right">Gross Pay</th>
                              <th className="py-2 px-3 text-right">Tax Withheld</th>
                              <th className="py-2 px-3 text-right">Net Pay</th>
                              <th className="py-2 px-3 text-right">Slips</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {run.items.map(item => (
                              <tr key={item.employeeId} className="hover:bg-gray-50/50">
                                <td className="py-2.5 px-3 font-semibold text-gray-800">{item.employeeName}</td>
                                <td className="py-2.5 px-3 text-center font-mono font-medium text-gray-500">
                                  {item.payType === 'HOURLY' ? `${item.hoursWorked} hrs @ $${item.payRate}/hr` : 'Salaried'}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-semibold text-gray-700">{businessProfile.currency}{item.grossPay.toFixed(2)}</td>
                                <td className="py-2.5 px-3 text-right font-mono text-amber-700">-{businessProfile.currency}{item.taxWithheld.toFixed(2)}</td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-teal-600">{businessProfile.currency}{item.netPay.toFixed(2)}</td>
                                <td className="py-2.5 px-3 text-right">
                                  <button
                                    onClick={() => setSelectedPayslip({ payrun: run, item })}
                                    className="text-[10px] font-bold text-teal-600 hover:text-teal-700 bg-gray-50 hover:bg-gray-100 py-1 px-2.5 rounded-lg border border-gray-200/50 transition-colors cursor-pointer"
                                  >
                                    View Slip
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

          </div>
        )}

        {/* ================= SUB-TAB 4: TIMESHEET APPROVALS HUB (NEW) ================= */}
        {activeSubTab === 'timesheets' && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Timesheet Auditing & Verification</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">Managers approve logged staff hours which then automatically feed base rates when executing payruns.</p>
              </div>
            </div>

            <div className="space-y-3">
              {timesheets.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl p-12 text-center text-gray-400 italic">No timesheet files currently pending approval.</div>
              ) : (
                timesheets.map(ts => (
                  <div key={ts.id} className="border border-gray-100 bg-gray-50/20 hover:border-gray-150 rounded-2xl p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4 transition-all shadow-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-gray-800">{ts.employeeName}</span>
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                          ts.status === 'PENDING' ? 'bg-amber-100 text-amber-800' :
                          ts.status === 'APPROVED' ? 'bg-teal-100 text-teal-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {ts.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">Period: <span className="font-mono font-semibold">{ts.startDate}</span> to <span className="font-mono font-semibold">{ts.endDate}</span></p>
                      {ts.notes && <p className="text-[11px] text-gray-400 italic mt-1 font-medium">Notes: "{ts.notes}"</p>}
                    </div>

                    <div className="flex items-center gap-5 self-end sm:self-auto">
                      <div className="text-right">
                        <span className="text-[8px] text-gray-400 font-black block uppercase">LOGGED HOURS</span>
                        <span className="text-sm font-black text-teal-700 font-mono">{ts.hoursWorked} hrs</span>
                      </div>

                      {ts.status === 'PENDING' && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => onUpdateTimesheetStatus(ts.id, 'REJECTED')}
                            className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg border border-red-200 cursor-pointer"
                            title="Reject Timesheet"
                          >
                            <X size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateTimesheetStatus(ts.id, 'APPROVED')}
                            className="p-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg cursor-pointer flex items-center gap-1 text-xs font-bold shadow"
                            title="Approve Timesheet"
                          >
                            <Check size={14} /> Approve
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ================= SUB-TAB 5: TAX REMITTANCE DESK (NEW) ================= */}
        {activeSubTab === 'remit' && (
          <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in">
            
            {/* Left: Make Tax Remittance */}
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                const remAmount = parseFloat((e.target as any).amount.value) || 0;
                const remMethod = (e.target as any).method.value as 'CASH' | 'CARD';
                const remQuarter = (e.target as any).quarter.value;

                if (remAmount <= 0) {
                  alert('Please provide a positive tax clearance amount.');
                  return;
                }

                onRemitTax(remAmount, remMethod, remQuarter);
                (e.target as any).reset();
                alert('Tax clearance disbursed! Clearing Sales Tax Payable liability in double-entry general ledger.');
              }}
              className="lg:col-span-5 bg-gray-50 border border-gray-100 rounded-2xl p-5 space-y-4 shadow-xs self-start"
            >
              <div className="border-b border-gray-200 pb-2 mb-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-teal-600">Withholdings Clearance</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">Submit withheld income tax PAYG funds to revenue authorities.</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Clearance Period / Quarter *</label>
                <input
                  type="text"
                  required
                  name="quarter"
                  placeholder="e.g. Q1 Fiscal 2026 Remittance"
                  className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Remittance Amount ({businessProfile.currency}) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  name="amount"
                  placeholder="0.00"
                  className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Disbursing Account *</label>
                <select
                  name="method"
                  className="w-full bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                >
                  <option value="CARD">Bank checking account (1020)</option>
                  <option value="CASH">Physical Cash Drawer (1010)</option>
                </select>
              </div>

              <button
                type="submit"
                className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 rounded-xl text-xs shadow flex items-center justify-center gap-1 transition-colors cursor-pointer"
              >
                <Plus size={14} /> Clear Tax Liabilities
              </button>
            </form>

            {/* Right: Remittance Records History */}
            <div className="lg:col-span-7 bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-teal-600 border-b border-gray-150 pb-2">Government Remittance Records</h3>
              
              <div className="overflow-hidden border border-gray-100 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Remittance Target</th>
                      <th className="py-2 px-3">Tender</th>
                      <th className="py-2 px-3 text-right">Amount Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {taxRemittances.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-gray-400 italic">No tax clearances filed during this fiscal year.</td>
                      </tr>
                    ) : (
                      taxRemittances.map(rem => (
                        <tr key={rem.id}>
                          <td className="py-2.5 px-3 font-mono text-gray-500">{rem.paymentDate}</td>
                          <td className="py-2.5 px-3 font-semibold text-gray-800">{rem.quarter}</td>
                          <td className="py-2.5 px-3 font-semibold text-gray-400 text-[10px]">{rem.method === 'CASH' ? 'Cash Box' : 'Bank EFT'}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-teal-600">{businessProfile.currency}{rem.amount.toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

      </div>

      {/* ================= MODAL: ADD EMPLOYEE PROFILE ================= */}
      {isAddEmpOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleCreateEmployeeSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-xl w-full max-w-md overflow-hidden flex flex-col animate-scale-up">
            <div className="p-5 border-b border-gray-100 bg-teal-50/50">
              <h3 className="text-base font-bold text-gray-800">Register New Staff Profile</h3>
              <p className="text-xs text-gray-400 mt-0.5">Setup compensation parameters for active tracking</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="Jane Baker"
                    value={empName}
                    onChange={(e) => setEmpName(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Role / Job Title *</label>
                  <input
                    type="text"
                    required
                    placeholder="Head Baker"
                    value={empRole}
                    onChange={(e) => setEmpRole(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Pay Structure *</label>
                  <select
                    value={empPayType}
                    onChange={(e) => setEmpPayType(e.target.value as PayType)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="HOURLY">HOURLY WAGE</option>
                    <option value="SALARY">MONTHLY FLAT SALARY</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Wage Rate ({businessProfile.currency}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="e.g. 25.00 or 4500"
                    value={empRate}
                    onChange={(e) => setEmpRate(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Tax Withholding Rate (%)</label>
                  <input
                    type="number"
                    required
                    placeholder="15"
                    value={empTaxRate}
                    onChange={(e) => setEmpTaxRate(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Tax File Number (TFN)</label>
                  <input
                    type="text"
                    placeholder="TFN-901-232"
                    value={empTaxId}
                    onChange={(e) => setEmpTaxId(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Staff Contact Email</label>
                <input
                  type="email"
                  placeholder="staff@truffleco.com"
                  value={empEmail}
                  onChange={(e) => setEmpEmail(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button
                type="button"
                onClick={() => setIsAddEmpOpen(false)}
                className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2.5 px-4 rounded-xl text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow cursor-pointer"
              >
                Register Employee
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================= MODAL: VIEW & PRINT PAYSLIP SLIP ================= */}
      {selectedPayslip && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-xl w-full max-w-md overflow-hidden flex flex-col animate-scale-up">
            
            <div className="p-5 border-b border-gray-100 bg-slate-900 text-white flex justify-between items-center">
              <h3 className="text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck size={16} className="text-teal-400" /> Authorized Payslip
              </h3>
              <button
                onClick={() => setSelectedPayslip(null)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6 font-mono text-xs leading-relaxed text-gray-800">
              
              {/* Header */}
              <div className="text-center">
                <h4 className="text-base font-black uppercase tracking-wide text-teal-600">{businessProfile.name}</h4>
                <p className="text-[10px] text-gray-400 font-semibold mt-1">{businessProfile.address}</p>
                <div className="border-b border-dashed border-gray-300 my-3"></div>
                <h5 className="text-sm font-bold uppercase tracking-widest text-slate-700">Official Wages Statement</h5>
                <p className="text-[9px] text-gray-400 mt-1">Slip Ref: {selectedPayslip.payrun.payrunNo}-{selectedPayslip.item.employeeId}</p>
              </div>

              {/* Employee and run descriptors */}
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-gray-600 border-b border-dashed border-gray-200 pb-3">
                <p><span className="font-bold">Employee:</span> {selectedPayslip.item.employeeName}</p>
                <p className="text-right"><span className="font-bold">Tax File:</span> {employees.find(e => e.id === selectedPayslip.item.employeeId)?.taxId}</p>
                <p><span className="font-bold">Job Role:</span> {employees.find(e => e.id === selectedPayslip.item.employeeId)?.role}</p>
                <p className="text-right"><span className="font-bold">Paid on:</span> {selectedPayslip.payrun.paymentDate}</p>
                <p className="col-span-2 pt-1 border-t border-gray-100 mt-1">
                  <span className="font-bold">Pay period:</span> {selectedPayslip.payrun.startDate} to {selectedPayslip.payrun.endDate}
                </p>
              </div>

              {/* Earnings Breakdown */}
              <div className="space-y-2 text-[11px]">
                <div className="flex justify-between font-bold border-b border-gray-200 pb-1 text-slate-700">
                  <span>Pay Elements</span>
                  <span>Calculations / Rates</span>
                  <span className="text-right">Total Amount</span>
                </div>

                <div className="flex justify-between text-gray-600">
                  <span>Base Wages</span>
                  <span>
                    {selectedPayslip.item.payType === 'HOURLY' 
                      ? `${selectedPayslip.item.hoursWorked} hrs @ $${selectedPayslip.item.payRate}` 
                      : 'Flat Salary'
                    }
                  </span>
                  <span className="text-right font-semibold text-gray-800">{businessProfile.currency}{selectedPayslip.item.grossPay.toFixed(2)}</span>
                </div>

                <div className="flex justify-between text-amber-700">
                  <span>PAYG Withholding Tax</span>
                  <span>Rate: {employees.find(e => e.id === selectedPayslip.item.employeeId)?.taxWithholdingRate}%</span>
                  <span className="text-right font-semibold">-{businessProfile.currency}{selectedPayslip.item.taxWithheld.toFixed(2)}</span>
                </div>

                <div className="border-t border-dashed border-gray-300 pt-2 flex justify-between text-xs font-black text-slate-900 bg-gray-50 p-2 rounded-lg">
                  <span>NET CASH TAKE-HOME:</span>
                  <span></span>
                  <span className="text-right font-mono text-teal-600">{businessProfile.currency}{selectedPayslip.item.netPay.toFixed(2)}</span>
                </div>
              </div>

              {/* Account disburse stamp */}
              <div className="text-center bg-gray-50 border border-gray-100 rounded-xl p-3 text-[10px] text-gray-500">
                <p className="font-bold text-teal-700 flex items-center justify-center gap-1.5">
                  <CreditCard size={13} /> Paid via {selectedPayslip.payrun.paymentMethod === 'CARD' ? 'Electronic Funds Transfer' : 'Cash Drawer'}
                </p>
                <p className="mt-0.5 font-medium">Reconciled to general ledger accounts 6020 & 2200.</p>
              </div>

              {/* print layout bottom */}
              <p className="text-[9px] text-center text-gray-400 mt-6 leading-normal">
                This document is a generated legal payslip confirming funds settlement in the state database. Retain for tax reporting purposes.
              </p>

            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button
                type="button"
                onClick={() => setSelectedPayslip(null)}
                className="flex-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-semibold py-2 px-4 rounded-xl text-xs"
              >
                Close Window
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded-xl text-xs shadow flex items-center justify-center gap-1.5"
              >
                <Printer size={13} /> Print Slip
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
