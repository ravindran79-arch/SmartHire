import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { 
    FileUp, Send, Loader2, AlertTriangle, CheckCircle, List, FileText, BarChart2,
    Save, Clock, Zap, ArrowLeft, Users, Briefcase, Layers, UserPlus, LogIn, Tag,
    Shield, User, HardDrive, Phone, Mail, Building, Trash2, Eye, DollarSign, Activity, 
    Printer, Download, MapPin, Calendar, ThumbsUp, ThumbsDown, Gavel, Paperclip, Copy, Award, Lock, CreditCard, Info,
    Scale, FileCheck, XCircle, Search, UserCheck, HelpCircle, GraduationCap, TrendingUp, Globe, Map, FileDown
} from 'lucide-react'; 

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { 
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, signOut, sendEmailVerification 
} from 'firebase/auth';
import { 
    // Added getDocs here
    getFirestore, collection, addDoc, onSnapshot, query, doc, setDoc, 
    runTransaction, deleteDoc, getDocs, getDoc, collectionGroup, orderBy, limit
} from 'firebase/firestore'; 

// --- FIREBASE INITIALIZATION ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- CONSTANTS ---
const API_URL = '/api/analyze'; 

// UPDATED: Recruitment Categories
const CATEGORY_ENUM = ["MUST_HAVE_SKILL", "EXPERIENCE", "EDUCATION", "CERTIFICATION", "SOFT_SKILLS", "LOCATION/LANG", "CULTURE_FIT"];
const MAX_FREE_AUDITS = 50; 

const PAGE = {
    HOME: 'HOME',
    COMPLIANCE_CHECK: 'COMPLIANCE_CHECK', 
    ADMIN: 'ADMIN',                     
    HISTORY: 'HISTORY' 
};

// --- SMARTHIRE JSON SCHEMA (THE BRAIN - UPDATED FOR GOD VIEW DATA) ---
const SMARTHIRE_REPORT_SCHEMA = {
    type: "OBJECT",
    description: "Recruitment Audit Report analyzing Candidate CV against Job Description.",
    properties: {
        // --- HEADER DATA ---
        "jobRole": { "type": "STRING", "description": "Job Title from JD." },
        "candidateName": { "type": "STRING", "description": "Name of the Candidate." },
        // NEW FIELDS FOR GOD VIEW
        "candidateLocation": { "type": "STRING", "description": "Detected city/country of candidate if present, else 'Unknown'." },
        "salaryIndication": { "type": "STRING", "description": "Detected current or expected salary if present, else 'Not Specified'." },
        
        // --- CANDIDATE HIGHLIGHTS ---
        "candidateSummary": {
            "type": "OBJECT",
            "properties": {
                // Changed to number for easier aggregation
                "yearsExperienceNum": { "type": "NUMBER", "description": "Numeric value of years experience (e.g., 5.5). Use 0 if none." },
                "currentRole": { "type": "STRING", "description": "Current or most recent job title." },
                "educationLevel": { "type": "STRING", "description": "Highest degree or qualification found." }
            }
        },

        // --- SUITABILITY METRICS ---
        "suitabilityScore": { 
            "type": "NUMBER", 
            "description": "0-100 Score. 100 = Perfect Match, 0 = No Match. Based on skills and experience alignment." 
        },
        "fitLevel": { "type": "STRING", "enum": ["EXCELLENT FIT", "GOOD FIT", "AVERAGE", "POOR FIT"] },
        
        // --- GAP ANALYSIS (Formerly Red Lines) ---
        "skillGaps": { 
            "type": "ARRAY", 
            "items": { "type": "STRING" },
            "description": "List of missing skills or requirements (e.g., 'Missing React Native experience', 'No PMP Certification')." 
        },

        // --- INTERVIEW STRATEGY (NEW FEATURE) ---
        "interviewQuestions": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "topic": { "type": "STRING", "description": "The area of concern or interest (e.g., 'Leadership', 'Python Gap')." },
                    "question": { "type": "STRING", "description": "A suggested behavioral question to ask the candidate." }
                }
            },
            "description": "3-5 suggested interview questions targeting the candidate's weak points or verifying specific strengths."
        },

        // --- DETAILED ANALYSIS ---
        "executiveSummary": { "type": "STRING", "description": "3-sentence summary for the Hiring Manager." },
        "findings": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "requirementFromJD": { "type": "STRING" },
                    "candidateEvidence": { "type": "STRING" },
                    "matchScore": { 
                        "type": "NUMBER", 
                        "description": "1 = Strong Match, 0.5 = Partial/Transferable, 0 = Missing." 
                    },
                    "flag": { "type": "STRING", "enum": ["MATCH", "PARTIAL", "MISSING"] },
                    "category": { "type": "STRING", "enum": CATEGORY_ENUM },
                    "recruiterAction": { 
                        "type": "STRING", 
                        "description": "Advice: e.g., 'Verify depth of knowledge', 'Acceptable alternative', 'Critical miss'." 
                    }
                }
            }
        }
    },
    "required": ["jobRole", "candidateName", "candidateLocation", "salaryIndication", "suitabilityScore", "fitLevel", "candidateSummary", "skillGaps", "interviewQuestions", "executiveSummary", "findings"]
};

// --- UTILS ---
const fetchWithRetry = async (url, options, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            return response;
        } catch (error) {
            if (i === maxRetries - 1) throw error; 
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
    }
};

const getUsageDocRef = (db, userId) => doc(db, `users/${userId}/usage_limits`, 'smarthire_tracker');
const getReportsCollectionRef = (db, userId) => collection(db, `users/${userId}/candidate_reports`);

const processFile = (file) => {
    return new Promise(async (resolve, reject) => {
        const fileExtension = file.name.split('.').pop().toLowerCase();
        const reader = new FileReader();
        if (fileExtension === 'txt') {
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        } else if (fileExtension === 'pdf') {
            if (typeof window.pdfjsLib === 'undefined') return reject("PDF lib not loaded.");
            reader.onload = async (event) => {
                try {
                    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(event.target.result) }).promise;
                    let fullText = '';
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();
                        fullText += textContent.items.map(item => item.str).join(' ') + '\n\n'; 
                    }
                    resolve(fullText);
                } catch (e) { reject(e.message); }
            };
            reader.readAsArrayBuffer(file);
        } else if (fileExtension === 'docx') {
            if (typeof window.mammoth === 'undefined') return reject("DOCX lib not loaded.");
            reader.onload = async (event) => {
                try {
                    const result = await window.mammoth.extractRawText({ arrayBuffer: event.target.result });
                    resolve(result.value); 
                } catch (e) { reject(e.message); }
            };
            reader.readAsArrayBuffer(file);
        } else {
            reject('Unsupported file type.');
        }
    });
};

class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { hasError: false, error: null }; }
    static getDerivedStateFromError(error) { return { hasError: true }; }
    componentDidCatch(error, errorInfo) { this.setState({ error, errorInfo }); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-red-900 font-body p-8 text-white flex items-center justify-center">
                    <div className="bg-red-800 p-8 rounded-xl border border-red-500 max-w-lg">
                        <AlertTriangle className="w-8 h-8 text-red-300 mx-auto mb-4"/>
                        <h2 className="text-xl font-bold mb-2">System Error</h2>
                        <p className="text-sm font-mono">{this.state.error && this.state.error.toString()}</p>
                    </div>
                </div>
            );
        }
        return this.props.children; 
    }
}

// --- LEAF COMPONENTS ---
const handleFileChange = (e, setFile, setErrorMessage) => {
    if (e.target.files.length > 0) {
        setFile(e.target.files[0]);
        if (setErrorMessage) setErrorMessage(null); 
    }
};

const FormInput = ({ label, name, value, onChange, type, placeholder, id }) => (
    <div>
        <label htmlFor={id || name} className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
        <input
            id={id || name}
            name={name}
            type={type}
            value={value}
            onChange={onChange}
            placeholder={placeholder || ''}
            required={label.includes('*')}
            className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:ring-blue-500 focus:border-blue-500 text-sm"
        />
    </div>
);

const PaywallModal = ({ show, onClose, userId }) => {
    if (!show) return null;
    // UPDATED: Your specific SmartProcure Stripe link
    const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/bJecN43FD39I8zz5JxafS02"; 

    const handleUpgrade = () => {
        if (userId) {
            window.location.href = `${STRIPE_PAYMENT_LINK}?client_reference_id=${userId}`;
        } else {
            alert("Error: User ID missing. Please log in again.");
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 no-print">
            <div className="bg-slate-800 rounded-2xl shadow-2xl border border-blue-500/50 max-w-md w-full p-8 text-center relative">
                <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-blue-600 rounded-full p-4 shadow-lg shadow-blue-500/50">
                    <Lock className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-white mt-8 mb-2">Screening Limit Reached</h2>
                <p className="text-slate-300 mb-6">
                    You have used your <span className="text-blue-400 font-bold">{MAX_FREE_AUDITS} Free Audits</span>.
                    <br/>To continue screening candidates, upgrade to Pro.
                </p>
                <div className="bg-slate-700/50 rounded-xl p-4 mb-6 text-left space-y-3">
                    <div className="flex items-center text-sm text-white"><CheckCircle className="w-4 h-4 mr-3 text-green-400"/> Unlimited CV Screenings</div>
                    <div className="flex items-center text-sm text-white"><CheckCircle className="w-4 h-4 mr-3 text-green-400"/> Auto-Generated Interview Questions</div>
                    <div className="flex items-center text-sm text-white"><CheckCircle className="w-4 h-4 mr-3 text-green-400"/> Bulk Candidate Ranking</div>
                </div>
                <button 
                    onClick={handleUpgrade}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg mb-3 flex items-center justify-center"
                >
                    <CreditCard className="w-5 h-5 mr-2"/> Upgrade - $10/mo
                </button>
                <button onClick={onClose} className="text-sm text-slate-400 hover:text-white">
                    Maybe Later (Return to Home)
                </button>
            </div>
        </div>
    );
};

const FileUploader = ({ title, file, setFile, color, requiredText, icon: Icon }) => (
    <div className={`p-6 border-2 border-dashed border-${color}-600/50 rounded-2xl bg-slate-900/50 space-y-3 no-print`}>
        <h3 className={`text-lg font-bold text-${color}-400 flex items-center`}>
            {Icon && <Icon className={`w-6 h-6 mr-2 text-${color}-500`} />} 
            {title}
        </h3>
        <p className="text-sm text-slate-400">{requiredText}</p>
        <input type="file" accept=".txt,.pdf,.docx" onChange={setFile} className="w-full text-base text-slate-300"/>
        {file && <p className="text-sm font-medium text-green-400 flex items-center"><CheckCircle className="w-4 h-4 mr-1 text-green-500" /> {file.name}</p>}
    </div>
);

// --- MID-LEVEL COMPONENTS (RECRUITMENT VIEW) ---

const ComplianceReport = ({ report }) => {
    const findings = report.findings || []; 
    const fitColor = report.fitLevel === 'POOR FIT' ? 'text-red-500' 
        : report.fitLevel === 'AVERAGE' ? 'text-amber-500' : 'text-green-500';

    return (
        <div id="printable-compliance-report" className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 mt-8">
            <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
                <div>
                    <h2 className="text-3xl font-extrabold text-white flex items-center"><UserCheck className="w-8 h-8 mr-3 text-blue-400"/> Candidate Suitability Report</h2>
                    <p className="text-slate-400 text-sm mt-1">Role: <span className="text-white font-bold">{report.jobRole || "N/A"}</span> | Candidate: <span className="text-white font-bold">{report.candidateName || "Unknown"}</span></p>
                </div>
                <button 
                    onClick={() => window.print()} 
                    className="text-sm text-slate-400 hover:text-white bg-slate-700 px-3 py-2 rounded-lg flex items-center no-print"
                >
                    <Printer className="w-4 h-4 mr-2"/> Print / PDF
                </button>
            </div>

            {report.executiveSummary && (
                <div className="mb-8 p-6 bg-gradient-to-r from-blue-900/40 to-slate-800 rounded-xl border border-blue-500/30">
                    <div className="flex justify-between items-start mb-3">
                        <h3 className="text-xl font-bold text-blue-200 flex items-center"><FileText className="w-5 h-5 mr-2 text-blue-400"/> Recruiter's Executive Summary</h3>
                        <button 
                            onClick={() => navigator.clipboard.writeText(report.executiveSummary)}
                            className="text-xs flex items-center bg-blue-700 hover:bg-blue-600 text-white px-3 py-1 rounded transition no-print"
                        >
                            <Copy className="w-3 h-3 mr-1"/> Copy Text
                        </button>
                    </div>
                    <p className="text-slate-300 italic leading-relaxed border-l-4 border-blue-500 pl-4 whitespace-pre-line">"{report.executiveSummary}"</p>
                </div>
            )}

            <div className="mb-10 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-5 bg-slate-700/50 rounded-xl border border-blue-600/50 text-center">
                    <p className="text-sm font-semibold text-white mb-1"><BarChart2 className="w-4 h-4 inline mr-2"/> Suitability Score</p>
                    <div className="text-5xl font-extrabold text-blue-400">{report.suitabilityScore}%</div>
                    <div className="text-xs text-slate-400 mt-2">Alignment with Job Description</div>
                </div>
                
                <div className="p-5 bg-slate-700/50 rounded-xl border border-amber-600/50 text-center relative overflow-hidden">
                    <p className="text-sm font-semibold text-white mb-1"><Activity className="w-4 h-4 inline mr-2 text-amber-400"/> Fit Assessment</p>
                    <div className={`text-4xl font-extrabold ${fitColor} mt-2`}>{report.fitLevel}</div>
                    <div className="mt-3">
                        {report.skillGaps?.length > 0 ? (
                             <span className="px-3 py-1 rounded-full bg-red-900/50 border border-red-500 text-xs text-red-300 font-bold uppercase">
                                {report.skillGaps.length} Skill Gaps Found
                            </span>
                        ) : (
                            <span className="px-3 py-1 rounded-full bg-green-900/50 border border-green-500 text-xs text-green-300 font-bold uppercase">
                                Solid Match
                            </span>
                        )}
                    </div>
                </div>

                 <div className="p-5 bg-slate-700/50 rounded-xl border border-purple-600/50 text-center">
                    <p className="text-sm font-semibold text-white mb-1"><Briefcase className="w-4 h-4 inline mr-2 text-purple-400"/> Experience Level</p>
                    {/* Display numeric experience nicely */}
                    <div className="text-3xl font-extrabold text-white mt-4">{report.candidateSummary?.yearsExperienceNum > 0 ? `${report.candidateSummary.yearsExperienceNum} Yrs` : "N/A"}</div>
                    <div className="text-xs text-slate-400 mt-1">{report.candidateSummary?.educationLevel}</div>
                </div>
            </div>

            <div className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 bg-slate-900/50 rounded-xl border border-slate-700">
                    <h4 className="text-lg font-bold text-white mb-3"><GraduationCap className="w-5 h-5 inline mr-2 text-blue-400"/> Candidate Profile</h4>
                    <ul className="space-y-3">
                         <li className="flex justify-between border-b border-slate-800 pb-2">
                            <span className="text-slate-400 text-sm">Current Role</span>
                            <span className="text-white text-sm font-bold text-right">{report.candidateSummary?.currentRole || "N/A"}</span>
                        </li>
                        {/* NEW LOCATION FIELD */}
                        <li className="flex justify-between border-b border-slate-800 pb-2">
                            <span className="text-slate-400 text-sm">Location</span>
                            <span className="text-white text-sm font-bold text-right">{report.candidateLocation || "Unknown"}</span>
                        </li>
                        {/* NEW SALARY FIELD */}
                         <li className="flex justify-between border-b border-slate-800 pb-2">
                            <span className="text-slate-400 text-sm">Salary Indication</span>
                            <span className="text-white text-sm font-bold text-right">{report.salaryIndication || "Not Specified"}</span>
                        </li>
                        <li className="flex justify-between border-b border-slate-800 pb-2">
                            <span className="text-slate-400 text-sm">Education</span>
                            <span className="text-white text-sm font-bold text-right">{report.candidateSummary?.educationLevel || "N/A"}</span>
                        </li>
                    </ul>
                </div>
                
                <div className="p-5 bg-slate-900/50 rounded-xl border border-slate-700">
                    <h4 className="text-lg font-bold text-white mb-3"><AlertTriangle className="w-5 h-5 inline mr-2 text-red-400"/> Skill Gaps Identified</h4>
                    {report.skillGaps?.length > 0 ? (
                        <ul className="space-y-2">
                            {report.skillGaps.map((item, i) => (
                                 <li key={i} className="flex items-center p-2 bg-red-900/20 border border-red-900/50 rounded">
                                    <XCircle className="w-4 h-4 mr-2 text-red-500 min-w-[16px]"/>
                                    <span className="text-sm text-red-200">{item}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-green-400 text-sm italic flex items-center"><CheckCircle className="w-4 h-4 mr-2"/> No critical gaps found.</p>
                    )}
                </div>
            </div>

            {report.interviewQuestions?.length > 0 && (
                <div className="mb-10 p-6 bg-slate-900 rounded-xl border border-slate-700 border-l-4 border-l-purple-500">
                    <h4 className="text-xl font-bold text-white mb-4 flex items-center"><HelpCircle className="w-6 h-6 mr-2 text-purple-400"/> Suggested Interview Questions</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {report.interviewQuestions.map((q, i) => (
                            <div key={i} className="p-4 bg-slate-800 rounded-lg border border-slate-700 hover:border-purple-500/50 transition">
                                <p className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-1">{q.topic}</p>
                                <p className="text-slate-200 text-sm font-medium">"{q.question}"</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <h3 className="text-2xl font-bold text-white mb-6 border-b border-slate-700 pb-3">Detailed Requirement Match</h3>
            <div className="space-y-6">
                {findings.map((item, index) => (
                    <div key={index} className="p-5 border border-slate-700 rounded-xl shadow-md space-y-3 bg-slate-800 hover:bg-slate-700/50 transition">
                        <div className="flex justify-between items-start">
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{item.category}</span>
                            <div className={`px-4 py-1 text-sm font-semibold rounded-full border ${item.flag === 'MATCH' ? 'bg-green-700/30 text-green-300 border-green-500' : item.flag === 'PARTIAL' ? 'bg-amber-700/30 text-amber-300 border-amber-500' : 'bg-red-700/30 text-red-300 border-red-500'}`}>{item.flag}</div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <p className="font-semibold text-slate-400 text-xs mb-1">Job Requirement:</p>
                                <p className="text-slate-200 text-sm">{item.requirementFromJD}</p>
                            </div>
                            <div>
                                <p className="font-semibold text-slate-400 text-xs mb-1">Candidate Evidence:</p>
                                <p className="text-slate-300 text-sm italic">{item.candidateEvidence || "Not found in CV"}</p>
                            </div>
                        </div>
                        
                        {item.recruiterAction && (
                            <div className="mt-2 pt-3 border-t border-slate-700/50">
                                <p className="text-xs text-blue-300"><span className="font-bold">Recommendation:</span> {item.recruiterAction}</p>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

const ComplianceRanking = ({ reportsHistory, loadReportFromHistory, deleteReport, currentUser }) => { 
    if (reportsHistory.length === 0) return null;
    const groupedReports = reportsHistory.reduce((acc, report) => {
        const jobRole = report.jobRole || "Untitled Role";
        const percentage = report.suitabilityScore || 0;
        if (!acc[jobRole]) acc[jobRole] = { allReports: [], count: 0 };
        acc[jobRole].allReports.push({ ...report, percentage });
        acc[jobRole].count += 1;
        return acc;
    }, {});
    const rankedProjects = Object.entries(groupedReports).filter(([_, data]) => data.allReports.length >= 1).sort(([nameA], [nameB]) => nameA.localeCompare(nameB));
    
    return (
        <div className="mt-8">
            <h2 className="text-xl font-bold text-white flex items-center mb-4 border-b border-slate-700 pb-2"><Layers className="w-5 h-5 mr-2 text-blue-400"/> Candidate Ranking by Role</h2>
            <div className="space-y-6">
                {rankedProjects.map(([jobRole, data]) => (
                    <div key={jobRole} className="p-5 bg-slate-700/50 rounded-xl border border-slate-600 shadow-lg">
                        <h3 className="text-lg font-extrabold text-blue-400 mb-4 border-b border-slate-600 pb-2">{jobRole} <span className="text-sm font-normal text-slate-400">({data.count} Candidates Scanned)</span></h3>
                        <div className="space-y-3">
                            {data.allReports.sort((a, b) => b.percentage - a.percentage).map((report, idx) => (
                                <div key={report.id} className="p-3 rounded-lg border border-slate-600 bg-slate-900/50 space-y-2 flex justify-between items-center hover:bg-slate-700/50">
                                    <div className='flex items-center cursor-pointer' onClick={() => loadReportFromHistory(report)}>
                                        <div className={`text-xl font-extrabold w-8 ${idx === 0 ? 'text-green-400' : 'text-slate-500'}`}>#{idx + 1}</div>
                                        <div className='ml-3'>
                                            <p className="text-sm font-medium text-white">{report.candidateName || "Unknown"}</p>
                                            <p className="text-xs text-slate-400">{new Date(report.timestamp).toLocaleDateString()}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center">
                                        {currentUser && currentUser.role === 'ADMIN' && <button onClick={(e) => {e.stopPropagation(); deleteReport(report.id, report.jobRole, report.candidateName, report.ownerId || currentUser.uid);}} className="mr-2 p-1 bg-red-600 rounded"><Trash2 className="w-4 h-4 text-white"/></button>}
                                        <span className={`px-2 py-0.5 rounded text-sm font-bold ${report.percentage > 80 ? 'bg-green-600 text-white' : report.percentage > 50 ? 'bg-amber-600 text-white' : 'bg-red-600 text-white'}`}>{report.percentage}% Fit</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const ReportHistory = ({ reportsHistory, loadReportFromHistory, isAuthReady, userId, setCurrentPage, currentUser, deleteReport, handleLogout }) => { 
    if (!isAuthReady || !userId) return <div className="text-center text-red-400">Please login to view history.</div>;
    return (
        <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
            <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-3">
                <h2 className="text-xl font-bold text-white flex items-center"><Clock className="w-5 h-5 mr-2 text-blue-500"/> Saved Candidates ({reportsHistory.length})</h2>
                <div className="flex gap-2">
                    <button onClick={() => setCurrentPage(PAGE.COMPLIANCE_CHECK)} className="text-sm text-slate-400 hover:text-blue-500 flex items-center"><ArrowLeft className="w-4 h-4 mr-1"/> Back</button>
                    <button onClick={handleLogout} className="text-sm text-slate-400 hover:text-red-400 flex items-center ml-4">Logout</button>
                </div>
            </div>
            <ComplianceRanking reportsHistory={reportsHistory} loadReportFromHistory={loadReportFromHistory} deleteReport={deleteReport} currentUser={currentUser} />
        </div>
    );
};

const AuthPage = ({ setCurrentPage, setErrorMessage, errorMessage, db, auth, isRegisteringRef }) => {
    const [regForm, setRegForm] = useState({ name: '', designation: '', company: '', email: '', phone: '', password: '' });
    const [loginForm, setLoginForm] = useState({ email: '', password: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleRegChange = (e) => setRegForm({ ...regForm, [e.target.name]: e.target.value });
    const handleLoginChange = (e) => setLoginForm({ ...loginForm, [e.target.name]: e.target.value });

    const handleRegister = async (e) => {
        e.preventDefault();
        setErrorMessage(null);
        setIsSubmitting(true);
        isRegisteringRef.current = true;

        try {
            const userCred = await createUserWithEmailAndPassword(auth, regForm.email, regForm.password);
            await sendEmailVerification(userCred.user);
            await setDoc(doc(db, 'users', userCred.user.uid), {
                name: regForm.name,
                designation: regForm.designation,
                company: regForm.company,
                email: regForm.email,
                phone: regForm.phone,
                role: 'RECRUITER',
                // ADDED SOURCE APP TRACKING
                registeredVia: 'SMARTHIRE', 
                createdAt: Date.now()
            });
            await addDoc(collection(db, 'mail'), {
                to: regForm.email,
                message: {
                    subject: 'Welcome to SmartHire – Start Screening Candidates',
                    html: `<p>Hi ${regForm.name},</p><p>Welcome to <strong>SmartHire</strong>.</p>`
                }
            });
            await signOut(auth);
            setLoginForm({ email: regForm.email, password: regForm.password });
            setErrorMessage('SUCCESS: Registration complete! A verification email has been sent. Please verify before logging in.'); 
        } catch (err) {
            console.error('Registration error', err);
            setErrorMessage(err.message || 'Registration failed.');
        } finally {
            setIsSubmitting(false);
            isRegisteringRef.current = false;
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setErrorMessage(null);
        setIsSubmitting(true);
        try {
            await signInWithEmailAndPassword(auth, loginForm.email, loginForm.password);
        } catch (err) {
            console.error('Login error', err);
            setErrorMessage(err.message || 'Login failed.');
            setIsSubmitting(false);
        }
    };

    const isSuccess = errorMessage && errorMessage.includes('SUCCESS');

    return (
        <div className="p-8 bg-slate-800 rounded-2xl shadow-2xl shadow-black/50 border border-slate-700 mt-12 mb-12">
            <h2 className="text-3xl font-extrabold text-white text-center">Welcome to SmartHire</h2>
            <p className="text-lg font-medium text-blue-400 text-center mb-6">AI-Driven Recruitment: Hire Faster, Remove Bias.</p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="p-6 bg-slate-700/50 rounded-xl border border-blue-500/50 shadow-inner space-y-4">
                    <h3 className="text-2xl font-bold text-blue-300 flex items-center mb-4"><UserPlus className="w-6 h-6 mr-2" /> Create Recruiter Account</h3>
                    <form onSubmit={handleRegister} className="space-y-3">
                        <FormInput id="reg-name" label="Full Name *" name="name" value={regForm.name} onChange={handleRegChange} type="text" />
                        <FormInput id="reg-designation" label="Designation (e.g. HR Manager)" name="designation" value={regForm.designation} onChange={handleRegChange} type="text" />
                        <FormInput id="reg-company" label="Company" name="company" value={regForm.company} onChange={handleRegChange} type="text" />
                        <FormInput id="reg-email" label="Email *" name="email" value={regForm.email} onChange={handleRegChange} type="email" />
                        <FormInput id="reg-phone" label="Contact Number" name="phone" value={regForm.phone} onChange={handleRegChange} type="tel" placeholder="Optional" />
                        <FormInput id="reg-password" label="Create Password *" name="password" value={regForm.password} onChange={handleRegChange} type="password" />
                        <button type="submit" disabled={isSubmitting} className={`w-full py-3 text-lg font-semibold rounded-xl text-slate-900 transition-all shadow-lg mt-6 bg-blue-400 hover:bg-blue-300 disabled:opacity-50 flex items-center justify-center`}>
                            {isSubmitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <UserPlus className="h-5 w-5 mr-2" />} {isSubmitting ? 'Registering...' : 'Register'}
                        </button>
                        <div className="mt-4 text-[10px] text-slate-500 text-center leading-tight">
                            By registering, you agree to our{' '}
                            <a
                                href="https://img1.wsimg.com/blobby/go/e7a89444-89f8-4812-8ce7-eba19bcc7358/downloads/84df3fa2-49e5-498f-b5fd-e3c9c1acdbc9/terms_of_service.pdf?ver=1766692591294"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:underline"
                            >
                                Terms of Service
                            </a>{' '}
                            &{' '}
                            <a
                                href="https://img1.wsimg.com/blobby/go/e7a89444-89f8-4812-8ce7-eba19bcc7358/downloads/4788a78c-fe6e-407d-8b11-ea83c986826a/privacy_policy.pdf?ver=1766692594896"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:underline"
                            >
                                Privacy Policy
                            </a>.
                        </div>
                    </form>
                </div>
                <div className="p-6 bg-slate-700/50 rounded-xl border border-green-500/50 shadow-inner flex flex-col justify-center">
                    <h3 className="text-2xl font-bold text-green-300 flex items-center mb-4"><LogIn className="w-6 h-6 mr-2" /> Recruiter Sign In</h3>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <FormInput id="login-email" label="Email *" name="email" value={loginForm.email} onChange={handleLoginChange} type="email" />
                        <FormInput id="login-password" label="Password *" name="password" value={loginForm.password} onChange={handleLoginChange} type="password" />
                        <button type="submit" disabled={isSubmitting} className={`w-full py-3 text-lg font-semibold rounded-xl text-slate-900 transition-all shadow-lg mt-6 bg-green-400 hover:bg-green-300 disabled:opacity-50 flex items-center justify-center`}>
                            {isSubmitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <LogIn className="h-5 w-5 mr-2" />} {isSubmitting ? 'Signing in...' : 'Sign In'}
                        </button>
                    </form>
                    {errorMessage && (
                        <div className={`mt-4 p-3 ${isSuccess ? 'bg-green-900/40 text-green-300 border-green-700' : 'bg-red-900/40 text-red-300 border-red-700'} border rounded-xl flex items-center`}>
                            {isSuccess ? <CheckCircle className="w-5 h-5 mr-3"/> : <AlertTriangle className="w-5 h-5 mr-3"/>} <p className="text-sm font-medium">{errorMessage}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- NEW ADMIN DASHBOARD COMPONENTS ---

// Helper to aggregate data for the "God View"
const calculateAdminStats = (reports) => {
    const stats = {
        totalReports: reports.length,
        avgScore: 0,
        avgExperience: 0,
        roleCounts: {},
        fitCounts: { "EXCELLENT FIT": 0, "GOOD FIT": 0, "AVERAGE": 0, "POOR FIT": 0 },
        skillGapCounts: {},
        locationCounts: {},
        salaryDataCount: 0 // Count how many had salary data
    };

    if (reports.length === 0) return stats;

    let totalScoreSum = 0;
    let totalExpSum = 0;
    let expCount = 0;

    reports.forEach(report => {
        // Scores & Fit
        totalScoreSum += (report.suitabilityScore || 0);
        if (report.fitLevel && stats.fitCounts[report.fitLevel] !== undefined) {
            stats.fitCounts[report.fitLevel]++;
        }
        
        // Roles
        const role = report.jobRole || "Unknown Role";
        stats.roleCounts[role] = (stats.roleCounts[role] || 0) + 1;

        // Experience
        const exp = report.candidateSummary?.yearsExperienceNum;
        if (exp !== undefined && exp !== null && !isNaN(exp)) {
            totalExpSum += exp;
            expCount++;
        }

        // Skill Gaps aggregation
        if (report.skillGaps && Array.isArray(report.skillGaps)) {
            report.skillGaps.forEach(gap => {
                // Simple normalization
                const normalizedGap = gap.toLowerCase().trim().replace(/[.,]/g, '');
                stats.skillGapCounts[normalizedGap] = (stats.skillGapCounts[normalizedGap] || 0) + 1;
            });
        }

        // Location agg
        const loc = report.candidateLocation;
        if(loc && loc !== "Unknown") {
             stats.locationCounts[loc] = (stats.locationCounts[loc] || 0) + 1;
        }

        // Salary Data existence check
        if(report.salaryIndication && report.salaryIndication !== "Not Specified") {
            stats.salaryDataCount++;
        }
    });

    stats.avgScore = (totalScoreSum / reports.length).toFixed(1);
    stats.avgExperience = expCount > 0 ? (totalExpSum / expCount).toFixed(1) : 0;

    return stats;
};

const StatCard = ({ icon: Icon, title, value, subtitle, color }) => (
    <div className={`p-6 bg-slate-700/50 rounded-xl border border-${color}-500/30 shadow-lg`}>
        <div className="flex justify-between items-start mb-4">
            <div>
                <p className="text-slate-400 text-sm font-medium uppercase tracking-wider">{title}</p>
                <h4 className={`text-4xl font-extrabold text-${color}-400 mt-2`}>{value}</h4>
            </div>
            <div className={`p-3 bg-${color}-500/20 rounded-lg`}>
                <Icon className={`w-8 h-8 text-${color}-400`} />
            </div>
        </div>
        {subtitle && <p className="text-slate-300 text-sm">{subtitle}</p>}
    </div>
);

const SimpleBarChart = ({ data, title, color, limitCount = 5 }) => {
    const sortedEntries = Object.entries(data).sort(([,a], [,b]) => b - a).slice(0, limitCount);
    const maxVal = sortedEntries.length > 0 ? sortedEntries[0][1] : 1;

    return (
        <div className="p-6 bg-slate-700/50 rounded-xl border border-slate-600 shadow-lg">
             <h4 className="text-lg font-bold text-white mb-4 flex items-center"><TrendingUp className={`w-5 h-5 mr-2 text-${color}-400`}/> {title}</h4>
             <div className="space-y-3">
                {sortedEntries.map(([key, value], i) => {
                     // Basic normalization for display if it's a long sentence-like gap
                    let displayKey = key.length > 40 ? key.substring(0, 40) + "..." : key;
                    // Capitalize first letter for display
                    displayKey = displayKey.charAt(0).toUpperCase() + displayKey.slice(1);

                    const percentage = (value / maxVal) * 100;
                    return (
                        <div key={i}>
                            <div className="flex justify-between text-sm text-slate-300 mb-1">
                                <span>{displayKey}</span>
                                <span className="font-bold">{value}</span>
                            </div>
                            <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                                <div className={`h-full bg-${color}-500 transition-all duration-500`} style={{ width: `${percentage}%` }}></div>
                            </div>
                        </div>
                    )
                })}
                {sortedEntries.length === 0 && <p className="text-slate-400 text-sm italic">No data yet.</p>}
             </div>
        </div>
    )
}

const AdminDashboard = ({ setCurrentPage, currentUser, reportsHistory, handleLogout, db }) => {
  const [stats, setStats] = useState(null);
  const [enrichedHistory, setEnrichedHistory] = useState([]);
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(true);
  // NEW STATES FOR USER REGISTRY
  const [allUsers, setAllUsers] = useState([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);


  // 1. Fetch company info for reports and calculate stats
  useEffect(() => {
    const enrichData = async () => {
        setIsLoadingAdmin(true);
        const userMap = {};
        const uniqueUserIds = [...new Set(reportsHistory.map(r => r.ownerId))];
        
        for (const uid of uniqueUserIds) {
            if(uid) {
                try {
                     const userDoc = await getDoc(doc(db, 'users', uid));
                     if(userDoc.exists()) {
                         userMap[uid] = userDoc.data().company || "Unknown Co.";
                     }
                } catch (e) { console.error("Error fetching user data for admin", e);}
            }
        }

        const enriched = reportsHistory.map(report => ({
            ...report,
            recruiterCompany: userMap[report.ownerId] || "N/A"
        }));
        setEnrichedHistory(enriched);
        setStats(calculateAdminStats(enriched));
        setIsLoadingAdmin(false);
    };

    if(reportsHistory.length > 0) {
        enrichData();
    } else {
         setStats(calculateAdminStats([]));
         setIsLoadingAdmin(false);
    }
  }, [reportsHistory, db]);

  // 2. NEW: Fetch all users for the registry list
  useEffect(() => {
      const fetchUsers = async () => {
          setIsLoadingUsers(true);
          try {
              const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
              const querySnapshot = await getDocs(q);
              const usersData = [];
              querySnapshot.forEach((doc) => {
                  // Filter out admins, we want prospects
                  if (doc.data().role !== 'ADMIN') {
                       usersData.push({ id: doc.id, ...doc.data() });
                  }
              });
              setAllUsers(usersData);
          } catch (error) {
              console.error("Error fetching users registry:", error);
          } finally {
              setIsLoadingUsers(false);
          }
      };
      if (db) { fetchUsers(); }
  }, [db]);

  // UPDATED: CSV Download handler with Source App
  const downloadCSV = (data, filename) => {
      if (data.length === 0) { alert("No data to export."); return; }
      // Added "Source App" header
      const headers = ["Full Name", "Designation", "Company", "Email", "Phone", "Source App", "Registered Date"];
      const rows = data.map(user => [
          `"${user.name || ''}"`,
          `"${user.designation || ''}"`,
          `"${user.company || ''}"`,
          `"${user.email || ''}"`,
          `"${user.phone || 'N/A'}"`,
          // Added Source App data column
          `"${user.registeredVia || 'Legacy/Unknown'}"`,
          `"${new Date(user.createdAt || Date.now()).toLocaleDateString()}"`
      ]);

      const csvContent = "data:text/csv;charset=utf-8," 
          + headers.join(",") + "\n" 
          + rows.map(e => e.join(",")).join("\n");

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", filename);
      document.body.appendChild(link); // Required for FF
      link.click();
      document.body.removeChild(link);
  };

  if (isLoadingAdmin) {
      return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin w-12 h-12 text-blue-400"/></div>;
  }

  return (
    <div id="admin-print-area" className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 space-y-8">
      <div className="flex justify-between items-center border-b border-slate-700 pb-4">
        <div>
             <h2 className="text-3xl font-bold text-white flex items-center"><Shield className="w-8 h-8 mr-3 text-red-500" /> Global Recruitment Intelligence (God View)</h2>
             <p className="text-slate-400 text-sm mt-1">Real-time analytics across all organizations.</p>
        </div>
        <div className="flex space-x-3 no-print">
            <button onClick={() => window.print()} className="text-sm text-slate-400 hover:text-white bg-slate-700 px-3 py-2 rounded-lg flex items-center"><Printer className="w-4 h-4 mr-2" /> Print Dashboard</button>
            <button onClick={handleLogout} className="text-sm text-slate-400 hover:text-red-400 flex items-center border border-slate-600 px-3 py-2 rounded-lg"><ArrowLeft className="w-4 h-4 mr-1" /> Logout</button>
        </div>
      </div>
      
      {/* KPI CARDS ROW */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard icon={Activity} title="Total Screenings" value={stats.totalReports} subtitle="All-time candidates processed" color="blue" />
        <StatCard icon={BarChart2} title="Avg Global Score" value={`${stats.avgScore}%`} subtitle="Mean suitability across all roles" color="purple" />
        <StatCard icon={Briefcase} title="Avg Candidate Exp." value={`${stats.avgExperience} Yrs`} subtitle="Based on extracted work history" color="green" />
      </div>

      {/* VISUAL DATA BARS ROW */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
         <SimpleBarChart data={stats.roleCounts} title="Top Roles Recruited" color="blue" limitCount={6} />
         <SimpleBarChart data={stats.fitCounts} title="Candidate Fit Distribution" color="amber" />
      </div>
      
       {/* MARKET INTEL ROW */}
       <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
         <SimpleBarChart data={stats.skillGapCounts} title="Top Market Skill Gaps (Missing Skills)" color="red" limitCount={6} />
         <div>
             <div className="grid grid-cols-1 gap-6">
                 <StatCard icon={DollarSign} title="Salary Data Points" value={stats.salaryDataCount} subtitle="Candidates with detectable salary info" color="green" />
                 <SimpleBarChart data={stats.locationCounts} title="Top Candidate Locations" color="purple" limitCount={4} />
             </div>
         </div>
      </div>

      {/* NEW SECTION: USER REGISTRY LIST */}
      <div className="pt-6 border-t border-slate-700">
        <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold text-white flex items-center"><Users className="w-6 h-6 mr-2 text-green-400" /> Registered User Registry & Upsell List</h3>
            <div className="flex space-x-2 no-print">
                <button onClick={() => window.print()} className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded flex items-center"><Printer className="w-3 h-3 mr-1" /> Print List</button>
                <button onClick={() => downloadCSV(allUsers, 'smarthire_users.csv')} className="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-2 rounded flex items-center"><FileDown className="w-3 h-3 mr-1" /> Export CSV</button>
            </div>
        </div>
        
        {isLoadingUsers ? (
            <div className="text-center py-4"><Loader2 className="animate-spin w-6 h-6 text-slate-400 mx-auto"/></div>
        ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700 max-h-[400px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-left text-sm text-slate-300">
                <thead className="text-xs uppercase bg-slate-900/50 text-slate-400 sticky top-0 z-10">
                    <tr>
                        <th className="px-6 py-4 rounded-tl-xl">Registered</th>
                        <th className="px-6 py-4">Full Name</th>
                        <th className="px-6 py-4">Designation</th>
                        <th className="px-6 py-4">Company</th>
                        <th className="px-6 py-4">Email</th>
                        {/* Added Source App Header */}
                        <th className="px-6 py-4">Source App</th>
                        <th className="px-6 py-4 rounded-tr-xl">Phone</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-700 bg-slate-800/50">
                    {allUsers.map(user => (
                        <tr key={user.id} className="hover:bg-slate-700/30 transition">
                            <td className="px-6 py-4 whitespace-nowrap">{new Date(user.createdAt).toLocaleDateString()}</td>
                            <td className="px-6 py-4 font-bold text-white">{user.name}</td>
                            <td className="px-6 py-4">{user.designation}</td>
                            <td className="px-6 py-4">{user.company}</td>
                            <td className="px-6 py-4 text-blue-300">{user.email}</td>
                            {/* Added Source App Data Cell with fallback */}
                            <td className="px-6 py-4 font-medium text-purple-300">{user.registeredVia || "Legacy/Unknown"}</td>
                            <td className="px-6 py-4">{user.phone || "N/A"}</td>
                        </tr>
                    ))}
                     {allUsers.length === 0 && <tr><td colSpan="7" className="px-6 py-8 text-center text-slate-500 italic">No users registered yet.</td></tr>}
                </tbody>
            </table>
        </div>
        )}
      </div>

      {/* RECENT ACTIVITY TABLE */}
      <div className="pt-6 border-t border-slate-700">
        <h3 className="text-xl font-bold text-white mb-6 flex items-center"><Eye className="w-6 h-6 mr-2 text-blue-400" /> Recent Live Screening Activity</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-700 max-h-[400px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-left text-sm text-slate-300">
                <thead className="text-xs uppercase bg-slate-900/50 text-slate-400 sticky top-0 z-10">
                    <tr>
                        <th className="px-6 py-4 rounded-tl-xl">Date</th>
                        <th className="px-6 py-4">Recruiting Company</th>
                        <th className="px-6 py-4">Role</th>
                        <th className="px-6 py-4">Candidate Location</th>
                        <th className="px-6 py-4 text-right rounded-tr-xl">Score</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-700 bg-slate-800/50">
                    {enrichedHistory.slice(0, 20).map(item => (
                        <tr key={item.id} className="hover:bg-slate-700/30 transition">
                            <td className="px-6 py-4 whitespace-nowrap">{new Date(item.timestamp).toLocaleDateString()}</td>
                            <td className="px-6 py-4 font-bold text-white"><Building className="w-4 h-4 inline mr-2 text-slate-500"/>{item.recruiterCompany}</td>
                            <td className="px-6 py-4 font-medium text-blue-300">{item.jobRole || "N/A"}</td>
                             <td className="px-6 py-4"><MapPin className="w-4 h-4 inline mr-1 text-slate-500"/>{item.candidateLocation || "Unknown"}</td>
                            <td className="px-6 py-4 text-right">
                                <span className={`px-2 py-1 rounded text-xs font-bold ${item.suitabilityScore > 80 ? 'bg-green-900/50 text-green-300 border border-green-500' : item.suitabilityScore > 50 ? 'bg-amber-900/50 text-amber-300 border border-amber-500' : 'bg-red-900/50 text-red-300 border border-red-500'}`}>
                                    {item.suitabilityScore}%
                                </span>
                            </td>
                        </tr>
                    ))}
                     {enrichedHistory.length === 0 && <tr><td colSpan="5" className="px-6 py-8 text-center text-slate-500 italic">No screening activity found yet.</td></tr>}
                </tbody>
            </table>
        </div>
      </div>
    </div>
  );
};

const AuditPage = ({ title, handleAnalyze, usageLimits, setCurrentPage, currentUser, loading, RFQFile, BidFile, setRFQFile, setBidFile, errorMessage, report, saveReport, saving, setErrorMessage, userId, handleLogout }) => {
  // REPLACE WITH YOUR LIVE STRIPE CUSTOMER PORTAL URL
  const STRIPE_PORTAL_LINK = "https://billing.stripe.com/p/login/YOUR_LIVE_PORTAL_LINK_HERE";
    return (
        <>
            <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
                <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-3">
                    <h2 className="text-2xl font-bold text-white">{title}</h2>
                    <div className="text-right">
                        {currentUser?.role === 'ADMIN' ? (
                            <p className="text-xs text-red-400 font-bold flex items-center justify-end"><Shield className="w-3 h-3 mr-1"/> Admin Mode</p>
                        ) : usageLimits.isSubscribed ? (
                            <div className="flex flex-col items-end space-y-1">
                                <div className="px-3 py-1 rounded-full bg-blue-500/20 border border-blue-500 text-blue-400 text-xs font-bold inline-flex items-center">
                                    <Award className="w-3 h-3 mr-1" /> Status: SmartHire Pro
                                </div>
                                <button onClick={() => window.open(STRIPE_PORTAL_LINK, '_blank')} className="text-xs text-slate-400 hover:text-red-400 underline decoration-dotted">Manage Subscription</button>
                            </div>
                        ) : (
                            <p className="text-xs text-slate-400">
                                Credits: <span className={usageLimits.bidderChecks >= MAX_FREE_AUDITS ? "text-red-500" : "text-green-500"}>
                                    {usageLimits.bidderChecks}/{MAX_FREE_AUDITS}
                                </span>
                            </p>
                        )}
                        <button onClick={handleLogout} className="text-sm text-slate-400 hover:text-blue-500 block ml-auto mt-1">Logout</button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <FileUploader title="Job Description (JD)" file={RFQFile} setFile={(e) => handleFileChange(e, setRFQFile, setErrorMessage)} color="blue" requiredText="Your Hiring Requirements" icon={Briefcase} />
                    <FileUploader title="Candidate CV / Resume" file={BidFile} setFile={(e) => handleFileChange(e, setBidFile, setErrorMessage)} color="purple" requiredText="The Candidate to Screen" icon={User} />
                </div>
                
                {errorMessage && <div className="mt-6 p-4 bg-red-900/40 text-red-300 border border-red-700 rounded-xl flex items-center"><AlertTriangle className="w-5 h-5 mr-3"/>{errorMessage}</div>}
                
                <button onClick={() => handleAnalyze('RECRUITER')} disabled={loading || !RFQFile || !BidFile} className="mt-8 w-full flex items-center justify-center px-8 py-4 text-lg font-semibold rounded-xl text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
                    {loading ? <Loader2 className="animate-spin h-6 w-6 mr-3" /> : <Search className="h-6 w-6 mr-3" />} {loading ? 'ANALYZING CANDIDATE...' : 'SCREEN CANDIDATE'}
                </button>
                
                {report && userId && <button onClick={() => saveReport('RECRUITER')} disabled={saving} className="mt-4 w-full flex items-center justify-center px-8 py-3 text-md font-semibold rounded-xl text-white bg-slate-600 hover:bg-slate-500 disabled:opacity-50"><Save className="h-5 w-5 mr-2" /> {saving ? 'SAVING...' : 'SAVE TO DATABASE'}</button>}
                {(report || userId) && <button onClick={() => setCurrentPage(PAGE.HISTORY)} className="mt-2 w-full flex items-center justify-center px-8 py-3 text-md font-semibold rounded-xl text-white bg-slate-700/80 hover:bg-slate-700"><List className="h-5 w-5 mr-2" /> VIEW CANDIDATES</button>}
            </div>
            {report && <ComplianceReport report={report} />}
        </>
    );
};

// --- APP COMPONENT ---
const App = () => {
    const [currentPage, setCurrentPage] = useState(PAGE.HOME);
    const [errorMessage, setErrorMessage] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [userId, setUserId] = useState(null);
    const [usageLimits, setUsageLimits] = useState({ initiatorChecks: 0, bidderChecks: 0, isSubscribed: false });
    const [reportsHistory, setReportsHistory] = useState([]);
    const [showPaywall, setShowPaywall] = useState(false);
    
    const isRegisteringRef = useRef(false); 

    const [RFQFile, setRFQFile] = useState(null);
    const [BidFile, setBidFile] = useState(null);
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const handleLogout = async () => {
        await signOut(auth);
        setUserId(null); setCurrentUser(null); setReportsHistory([]); setReport(null); setRFQFile(null); setBidFile(null);
        setUsageLimits({ initiatorChecks: 0, bidderChecks: 0, isSubscribed: false });
        setCurrentPage(PAGE.HOME); setErrorMessage(null);
    };

    useEffect(() => {
        if (!auth) return;
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setUserId(user.uid);
                try {
                    const userDoc = await getDoc(doc(db, 'users', user.uid));
                    const userData = userDoc.exists() ? userDoc.data() : { role: 'RECRUITER' };
                    setCurrentUser({ uid: user.uid, ...userData });
                    if (!isRegisteringRef.current) {
                        if (userData.role === 'ADMIN') setCurrentPage(PAGE.ADMIN);
                        else setCurrentPage(PAGE.COMPLIANCE_CHECK);
                    }
                } catch (error) { 
                    setCurrentUser({ uid: user.uid, role: 'RECRUITER' }); 
                    if (!isRegisteringRef.current) {
                         setCurrentPage(PAGE.COMPLIANCE_CHECK); 
                    }
                }
            } else {
                setUserId(null); setCurrentUser(null); setReportsHistory([]); setReport(null); setCurrentPage(PAGE.HOME);
            }
            setIsAuthReady(true);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (db && userId) {
            const docRef = getUsageDocRef(db, userId);
            const unsubscribe = onSnapshot(docRef, (docSnap) => {
                if (docSnap.exists()) {
                    setUsageLimits({ bidderChecks: docSnap.data().bidderChecks || 0, isSubscribed: docSnap.data().isSubscribed || false });
                } else {
                    setDoc(docRef, { bidderChecks: 0, isSubscribed: false }).catch(console.error);
                }
            });
            return () => unsubscribe();
        }
    }, [userId]);

    // Fetch History (Recruiter vs Admin View)
    useEffect(() => {
        if (!db || !currentUser) return;
        let unsubscribeSnapshot = null;
        let q;
        
        if (currentUser.role === 'ADMIN') { 
            // Admin gets everything, ordered by newest first, limited to last 100 for performance
            q = query(collectionGroup(db, 'candidate_reports'), orderBy('timestamp', 'desc'), limit(100)); 
        } else if (userId) { 
            // Recruiter gets only their own
            q = query(getReportsCollectionRef(db, userId)); 
        }
        
        if (q) {
            unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
                const history = [];
                snapshot.forEach(docSnap => {
                    // Important: For collectionGroup queries, we need to determine the ownerID from the path
                    const ownerId = docSnap.ref.parent.parent ? docSnap.ref.parent.parent.id : userId;
                    history.push({ id: docSnap.id, ownerId: ownerId, ...docSnap.data() });
                });
                // Sort again just to be safe if using recruiter view
                history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                setReportsHistory(history);
            });
        }
        return () => unsubscribeSnapshot && unsubscribeSnapshot();
    }, [userId, currentUser, db]); // Added db to dependencies

    useEffect(() => {
        const loadScript = (src) => {
            return new Promise((resolve, reject) => {
                if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
                const script = document.createElement('script');
                script.src = src; script.onload = resolve; script.onerror = () => reject();
                document.head.appendChild(script);
            });
        };
        const loadAllLibraries = async () => {
            try {
                if (!window.pdfjsLib) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js");
                if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
                if (!window.mammoth) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth.js/1.4.15/mammoth.browser.min.js");
            } catch (e) { console.warn("Doc parsing libs warning:", e); }
        };
        loadAllLibraries();
        
        const params = new URLSearchParams(window.location.search);
        if (params.get('client_reference_id') || params.get('payment_success')) {
             window.history.replaceState({}, document.title, "/");
        }
    }, []); 

    const incrementUsage = async () => {
        if (!db || !userId) return;
        const docRef = getUsageDocRef(db, userId);
        try {
            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(docRef);
                const currentData = docSnap.exists() ? docSnap.data() : { bidderChecks: 0, isSubscribed: false };
                if (!docSnap.exists()) transaction.set(docRef, currentData);
                transaction.update(docRef, { bidderChecks: (currentData.bidderChecks || 0) + 1 });
            });
        } catch (e) { console.error("Usage update failed:", e); }
    };

    const handleAnalyze = useCallback(async (role) => {
        if (currentUser?.role !== 'ADMIN' && !usageLimits.isSubscribed && usageLimits.bidderChecks >= MAX_FREE_AUDITS) {
            setShowPaywall(true);
            return;
        }
        if (!RFQFile || !BidFile) { setErrorMessage("Please upload both JD and CV."); return; }
        
        setLoading(true); setReport(null); setErrorMessage(null);

        try {
            const jdContent = await processFile(RFQFile);
            const cvContent = await processFile(BidFile);
            
            // --- UPDATED SYSTEM PROMPT FOR GOD VIEW DATA EXTRACTION ---
            const systemPrompt = {
                parts: [{
                    text: `You are the SmartHire AI Recruiter. 
                    Your goal is to screen a candidate CV against a Job Description (JD).
                    
                    TASK:
                    1. EXTRACT Metadata: Job Title, Candidate Name.
                    2. **NEW**: EXTRACT 'candidateLocation' (City/Country) from the CV if present. If not found, use "Unknown".
                    3. **NEW**: EXTRACT 'salaryIndication' (Current or expected salary) from the CV if explicitly stated. If not found, use "Not Specified".
                    4. EXTRACT 'yearsExperienceNum' as a number (e.g. 5 or 2.5).
                    5. CALCULATE 'Suitability Score' (0-100).
                    6. IDENTIFY 'Skill Gaps' (Red Lines).
                    7. GENERATE 3 'Interview Questions'.
                    8. COMPARE Line-by-Line evidence.
                    
                    OUTPUT: JSON matching the provided schema precisely.`
                }]
            };

            const userQuery = `
                <job_description>
                ${jdContent}
                </job_description>

                <candidate_cv>
                ${cvContent}
                </candidate_cv>
                
                Perform Recruitment Screening.
            `;

            const payload = {
                contents: [{ parts: [{ text: userQuery }] }],
                systemInstruction: systemPrompt,
                generationConfig: { 
                    responseMimeType: "application/json", 
                    responseSchema: SMARTHIRE_REPORT_SCHEMA 
                }
            };

            const response = await fetchWithRetry(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;

            if (jsonText) {
                setReport(JSON.parse(jsonText));
                await incrementUsage();
            } else { 
                throw new Error("AI returned invalid data."); 
            }

        } catch (error) {
            setErrorMessage(`Analysis failed: ${error.message}`);
        } finally { 
            setLoading(false); 
        }
    }, [RFQFile, BidFile, usageLimits, currentUser]);

    const saveReport = useCallback(async (role) => {
        if (!db || !userId || !report) { setErrorMessage("No report to save."); return; }
        setSaving(true);
        try {
            const reportsRef = getReportsCollectionRef(db, userId);
            await addDoc(reportsRef, {
                ...report,
                // Ensure defaults if AI missed them
                jobRole: report.jobRole || 'Untitled Role',
                candidateName: report.candidateName || 'Unknown Candidate',
                candidateLocation: report.candidateLocation || 'Unknown',
                salaryIndication: report.salaryIndication || 'Not Specified',
                timestamp: Date.now(),
                role: role, 
                ownerId: userId 
            });
            setErrorMessage("Candidate saved successfully!"); 
            setTimeout(() => setErrorMessage(null), 3000);
        } catch (error) {
            setErrorMessage(`Failed to save: ${error.message}.`);
        } finally { setSaving(false); }
    }, [db, userId, report, RFQFile, BidFile]);
    
    const deleteReport = useCallback(async (reportId, jobRole, candidateName) => {
        if (!db || !userId) return;
        setErrorMessage(`Deleting...`);
        try {
            const reportsRef = getReportsCollectionRef(db, userId);
            await deleteDoc(doc(reportsRef, reportId));
            if (report && report.id === reportId) setReport(null);
            setErrorMessage("Deleted!");
            setTimeout(() => setErrorMessage(null), 3000);
        } catch (error) { setErrorMessage(`Delete failed: ${error.message}`); }
    }, [db, userId, report]);

    const loadReportFromHistory = useCallback((historyItem) => {
        setRFQFile(null); setBidFile(null);
        setReport({ id: historyItem.id, ...historyItem });
        setCurrentPage(PAGE.COMPLIANCE_CHECK); 
        setErrorMessage(`Loaded: ${historyItem.candidateName}`);
        setTimeout(() => setErrorMessage(null), 3000);
    }, []);
    
    const renderPage = () => {
        switch (currentPage) {
            case PAGE.HOME:
                return <AuthPage 
                            setCurrentPage={setCurrentPage} 
                            setErrorMessage={setErrorMessage} 
                            errorMessage={errorMessage} 
                            db={db} 
                            auth={auth} 
                            isRegisteringRef={isRegisteringRef} 
                        />;
            case PAGE.COMPLIANCE_CHECK:
                return <AuditPage 
                    title="Candidate Screening & Fit Analysis" 
                    handleAnalyze={handleAnalyze} usageLimits={usageLimits} setCurrentPage={setCurrentPage}
                    currentUser={currentUser} loading={loading} RFQFile={RFQFile} BidFile={BidFile}
                    setRFQFile={setRFQFile} setBidFile={setBidFile} 
                    errorMessage={errorMessage} report={report} saveReport={saveReport} saving={saving}
                    setErrorMessage={setErrorMessage} userId={userId} handleLogout={handleLogout}
                />;
            case PAGE.ADMIN:
                // Pass DB to admin for fetching company names
                return <AdminDashboard setCurrentPage={setCurrentPage} currentUser={currentUser} reportsHistory={reportsHistory} loadReportFromHistory={loadReportFromHistory} handleLogout={handleLogout} db={db} />;
            case PAGE.HISTORY:
                return <ReportHistory reportsHistory={reportsHistory} loadReportFromHistory={loadReportFromHistory} deleteReport={deleteReport} isAuthReady={isAuthReady} userId={userId} setCurrentPage={setCurrentPage} currentUser={currentUser} handleLogout={handleLogout} />;
            default: return <AuthPage setCurrentPage={setCurrentPage} setErrorMessage={setErrorMessage} errorMessage={errorMessage} db={db} auth={auth} />;
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 font-body p-4 sm:p-8 text-slate-100">
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@100..900&display=swap');
                .font-body, .font-body * { font-family: 'Lexend', sans-serif !important; }
                input[type="file"] { display: block; width: 100%; }
                input[type="file"]::file-selector-button { background-color: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 10px; cursor: pointer; font-weight: 600; }
                .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #475569; border-radius: 3px; }
                @media print { 
                    body * { visibility: hidden; } 
                    #admin-print-area, #admin-print-area * { visibility: visible; } 
                    #admin-print-area { position: absolute; left: 0; top: 0; width: 100%; background: white; color: black; } 
                    #printable-compliance-report, #printable-compliance-report * { visibility: visible; }
                    #printable-compliance-report { position: absolute; left: 0; top: 0; width: 100%; background: white; color: black; }
                    .no-print { display: none !important; } 
                }
            `}</style>
            <div className="max-w-4xl mx-auto space-y-10">{renderPage()}</div>
            <PaywallModal show={showPaywall} onClose={() => setShowPaywall(false)} userId={userId} />
        </div>
    );
};

const MainApp = App;

function TopLevelApp() {
    return (
        <ErrorBoundary>
            <MainApp />
        </ErrorBoundary>
    );
}

export default TopLevelApp;
