import React, { useState, useCallback, useEffect } from 'react';
import { 
    FileUp, Send, Loader2, AlertTriangle, CheckCircle, List, FileText, BarChart2,
    Save, Clock, Zap, ArrowLeft, Users, Briefcase, Layers, UserPlus, LogIn, Tag,
    Shield, User, HardDrive, Phone, Mail, Building, Trash2, Eye, DollarSign, Activity, 
    Printer, Download, MapPin, Calendar, ThumbsUp, ThumbsDown, Gavel, Paperclip, Copy, Award, Lock, CreditCard, Info,
    Scale, FileCheck, XCircle, Search, UserCheck, HelpCircle, GraduationCap
} from 'lucide-react'; 

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { 
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, signOut, sendEmailVerification 
} from 'firebase/auth';
import { 
    getFirestore, collection, addDoc, onSnapshot, query, doc, setDoc, 
    runTransaction, deleteDoc, getDocs, getDoc, collectionGroup
} from 'firebase/firestore'; 

// --- FIREBASE INITIALIZATION ---
// Ensure your .env files are set up for the new project or reuse existing if sharing DB
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
// STRATEGIC CHANGE: Increased to 50 for Freemium Model
const MAX_FREE_AUDITS = 50; 

const PAGE = {
    HOME: 'HOME',
    COMPLIANCE_CHECK: 'COMPLIANCE_CHECK', 
    ADMIN: 'ADMIN',                     
    HISTORY: 'HISTORY' 
};

// --- SMARTHIRE JSON SCHEMA (THE BRAIN) ---
const SMARTHIRE_REPORT_SCHEMA = {
    type: "OBJECT",
    description: "Recruitment Audit Report analyzing Candidate CV against Job Description.",
    properties: {
        // --- HEADER DATA ---
        "jobRole": { "type": "STRING", "description": "Job Title from JD." },
        "candidateName": { "type": "STRING", "description": "Name of the Candidate." },
        
        // --- CANDIDATE HIGHLIGHTS ---
        "candidateSummary": {
            "type": "OBJECT",
            "properties": {
                "yearsExperience": { "type": "STRING", "description": "Total relevant years of experience extracted." },
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
    "required": ["jobRole", "candidateName", "suitabilityScore", "fitLevel", "candidateSummary", "skillGaps", "interviewQuestions", "executiveSummary", "findings"]
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

// --- METRIC CALCULATORS ---
const getMatchPercentage = (report) => {
    // If the AI returns a direct score, use it, otherwise calculate from findings
    if (report.suitabilityScore) return report.suitabilityScore;
    
    const findings = report.findings || []; 
    const totalScore = findings.reduce((sum, item) => {
        let score = item.matchScore || 0;
        if (score > 1) { score = score / 100; }
        return sum + score;
    }, 0);
    const maxScore = findings.length * 1;
    return maxScore > 0 ? parseFloat(((totalScore / maxScore) * 100).toFixed(1)) : 0;
};

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
    // UPDATE: Your actual Stripe link for SmartHire
    const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/00waEW2Bz25Eg212xlafS01"; 

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
    // Suitability Color Logic
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

            {/* EXECUTIVE SUMMARY */}
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

            {/* METRIC CARDS */}
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
                    <div className="text-3xl font-extrabold text-white mt-4">{report.candidateSummary?.yearsExperience || "N/A"}</div>
                    <div className="text-xs text-slate-400 mt-1">{report.candidateSummary?.educationLevel}</div>
                </div>
            </div>

            {/* CANDIDATE HIGHLIGHTS & GAPS */}
            <div className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 bg-slate-900/50 rounded-xl border border-slate-700">
                    <h4 className="text-lg font-bold text-white mb-3"><GraduationCap className="w-5 h-5 inline mr-2 text-blue-400"/> Candidate Profile</h4>
                    <ul className="space-y-3">
                         <li className="flex justify-between border-b border-slate-800 pb-2">
                            <span className="text-slate-400 text-sm">Current Role</span>
                            <span className="text-white text-sm font-bold text-right">{report.candidateSummary?.currentRole || "N/A"}</span>
                        </li>
                        <li className="flex justify-between border-b border-slate-800 pb-2">
                            <span className="text-slate-400 text-sm">Education</span>
                            <span className="text-white text-sm font-bold text-right">{report.candidateSummary?.educationLevel || "N/A"}</span>
                        </li>
                         <li className="flex justify-between">
                            <span className="text-slate-400 text-sm">Experience</span>
                            <span className="text-white text-sm font-bold text-right">{report.candidateSummary?.yearsExperience || "N/A"}</span>
                        </li>
                    </ul>
                </div>
                
                {/* SKILL GAPS (RED LINES) */}
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

            {/* INTERVIEW QUESTIONS (NEW FEATURE) */}
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

            {/* DETAILED FINDINGS */}
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

// --- PAGE COMPONENTS (AuthPage) ---
// FIX: Added setIsRegistering prop to AuthPage
const AuthPage = ({ setCurrentPage, setErrorMessage, errorMessage, db, auth, setIsRegistering }) => {
    const [regForm, setRegForm] = useState({ name: '', designation: '', company: '', email: '', phone: '', password: '' });
    const [loginForm, setLoginForm] = useState({ email: '', password: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleRegChange = (e) => setRegForm({ ...regForm, [e.target.name]: e.target.value });
    const handleLoginChange = (e) => setLoginForm({ ...loginForm, [e.target.name]: e.target.value });

    const handleRegister = async (e) => {
        e.preventDefault();
        setErrorMessage(null);
        setIsSubmitting(true);
        // FIX: Set flag to true to prevent auto-redirect in parent component
        setIsRegistering(true);

        try {
            const userCred = await createUserWithEmailAndPassword(auth, regForm.email, regForm.password);
            
            // --- EMAIL VERIFICATION ---
            await sendEmailVerification(userCred.user);
            
            await setDoc(doc(db, 'users', userCred.user.uid), {
                name: regForm.name,
                designation: regForm.designation,
                company: regForm.company,
                email: regForm.email,
                phone: regForm.phone,
                role: 'RECRUITER', 
                createdAt: Date.now()
            });

            // TRIGGER WELCOME EMAIL
            await addDoc(collection(db, 'mail'), {
                to: regForm.email,
                message: {
                    subject: 'Welcome to SmartHire – Start Screening Candidates',
                    html: `
                        <p>Hi ${regForm.name},</p>
                        <p>Welcome to <strong>SmartHire</strong>. Your automated AI recruitment assistant is ready.</p>
                        <p>You have <strong>${MAX_FREE_AUDITS} Free Candidate Screenings</strong> on us.</p>
                        <p>Get started by uploading a Job Description and a Candidate CV.</p>
                    `
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
            // FIX: Reset flag so subsequent logins work normally
            setIsRegistering(false);
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
                            {isSubmitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <UserPlus className="h-5 w-5 mr-2" />}
                            {isSubmitting ? 'Registering...' : 'Register'}
                        </button>
                        
                        <div className="mt-4 text-[10px] text-slate-500 text-center leading-tight">
                            By registering, you agree to our{' '}
                            <a href="/terms-of-service.pdf" target="_blank" className="text-blue-400 hover:underline">Terms of Service</a>
                            {' '}and{' '}
                            <a href="/privacy-policy.pdf" target="_blank" className="text-blue-400 hover:underline">Privacy Policy</a>.
                        </div>
                    </form>
                </div>

                <div className="p-6 bg-slate-700/50 rounded-xl border border-green-500/50 shadow-inner flex flex-col justify-center">
                    <h3 className="text-2xl font-bold text-green-300 flex items-center mb-4"><LogIn className="w-6 h-6 mr-2" /> Recruiter Sign In</h3>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <FormInput id="login-email" label="Email *" name="email" value={loginForm.email} onChange={handleLoginChange} type="email" />
                        <FormInput id="login-password" label="Password *" name="password" value={loginForm.password} onChange={handleLoginChange} type="password" />

                        <button type="submit" disabled={isSubmitting} className={`w-full py-3 text-lg font-semibold rounded-xl text-slate-900 transition-all shadow-lg mt-6 bg-green-400 hover:bg-green-300 disabled:opacity-50 flex items-center justify-center`}>
                            {isSubmitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <LogIn className="h-5 w-5 mr-2" />}
                            {isSubmitting ? 'Signing in...' : 'Sign In'}
                        </button>
                    </form>

                    {errorMessage && (
                        <div className={`mt-4 p-3 ${isSuccess ? 'bg-green-900/40 text-green-300 border-green-700' : 'bg-red-900/40 text-red-300 border-red-700'} border rounded-xl flex items-center`}>
                            {isSuccess ? <CheckCircle className="w-5 h-5 mr-3"/> : <AlertTriangle className="w-5 h-5 mr-3"/>}
                            <p className="text-sm font-medium">{errorMessage}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const AdminDashboard = ({ setCurrentPage, currentUser, reportsHistory, loadReportFromHistory, handleLogout }) => {
  return (
    <div id="admin-print-area" className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 space-y-8">
      <div className="flex justify-between items-center border-b border-slate-700 pb-4">
        <h2 className="text-3xl font-bold text-white flex items-center"><Shield className="w-8 h-8 mr-3 text-red-400" /> Admin Market Intel (Recruitment)</h2>
        <div className="flex space-x-3 no-print">
            <button onClick={() => window.print()} className="text-sm text-slate-400 hover:text-white bg-slate-700 px-3 py-2 rounded-lg"><Printer className="w-4 h-4 mr-2" /> Print</button>
            <button onClick={handleLogout} className="text-sm text-slate-400 hover:text-blue-500 flex items-center"><ArrowLeft className="w-4 h-4 mr-1" /> Logout</button>
        </div>
      </div>
      
      <div className="pt-4 border-t border-slate-700">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center"><Eye className="w-6 h-6 mr-2 text-blue-400" /> Recent Candidate Screenings</h3>
        <div className="space-y-4">{reportsHistory.slice(0, 15).map(item => (
            <div key={item.id} className="p-4 bg-slate-900/50 rounded-xl border border-slate-700 cursor-default hover:bg-slate-900">
                <div className="flex justify-between mb-2">
                    <div>
                        <h4 className="text-lg font-bold text-white">{item.jobRole || "Role"} <span className="text-sm text-slate-400">vs {item.candidateName || "Candidate"}</span></h4>
                    </div>
                    <div className="text-right"><div className="text-xl font-bold text-blue-400">{item.suitabilityScore}% Match</div></div>
                </div>
            </div>
        ))}</div>
      </div>
    </div>
  );
};

const AuditPage = ({ title, handleAnalyze, usageLimits, setCurrentPage, currentUser, loading, RFQFile, BidFile, setRFQFile, setBidFile, errorMessage, report, saveReport, saving, setErrorMessage, userId, handleLogout }) => {
    return (
        <>
            <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
                <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-3">
                    <h2 className="text-2xl font-bold text-white">{title}</h2>
                    <div className="text-right">
                        {currentUser?.role === 'ADMIN' ? (
                            <p className="text-xs text-green-400 font-bold">Admin Mode</p>
                        ) : usageLimits.isSubscribed ? (
                            <div className="flex flex-col items-end space-y-1">
                                <div className="px-3 py-1 rounded-full bg-blue-500/20 border border-blue-500 text-blue-400 text-xs font-bold inline-flex items-center">
                                    <Award className="w-3 h-3 mr-1" /> Status: SmartHire Pro
                                </div>
                                <button onClick={() => window.open('https://billing.stripe.com/p/login/test', '_blank')} className="text-xs text-slate-400 hover:text-red-400 underline decoration-dotted">Manage Subscription</button>
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
    
    // FIX: New state to track if registration is in progress
    const [isRegistering, setIsRegistering] = useState(false); 

    // Note: Variable names RFQFile/BidFile kept for code consistency with upload handler, 
    // but conceptually they are JD and CV now.
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
                    // FIX: Only redirect if we are NOT currently registering
                    if (!isRegistering) {
                        if (userData.role === 'ADMIN') setCurrentPage(PAGE.ADMIN);
                        else setCurrentPage(PAGE.COMPLIANCE_CHECK);
                    }
                } catch (error) { 
                    setCurrentUser({ uid: user.uid, role: 'RECRUITER' }); 
                    // FIX: Only redirect if we are NOT currently registering
                    if (!isRegistering) {
                         setCurrentPage(PAGE.COMPLIANCE_CHECK); 
                    }
                }
            } else {
                setUserId(null); setCurrentUser(null); setReportsHistory([]); setReport(null); setCurrentPage(PAGE.HOME);
            }
            setIsAuthReady(true);
        });
        return () => unsubscribe();
        // FIX: Add isRegistering to dependency array
    }, [isRegistering]);

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

    useEffect(() => {
        if (!db || !currentUser) return;
        let unsubscribeSnapshot = null;
        let q;
        // CHANGED: Collection name to 'candidate_reports'
        if (currentUser.role === 'ADMIN') { q = query(collectionGroup(db, 'candidate_reports')); } 
        else if (userId) { q = query(getReportsCollectionRef(db, userId)); }
        
        if (q) {
            unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
                const history = [];
                snapshot.forEach(docSnap => {
                    const ownerId = docSnap.ref.parent.parent ? docSnap.ref.parent.parent.id : userId;
                    history.push({ id: docSnap.id, ownerId: ownerId, ...docSnap.data() });
                });
                history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                setReportsHistory(history);
            });
        }
        return () => unsubscribeSnapshot && unsubscribeSnapshot();
    }, [userId, currentUser]);

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
            
            // --- UPDATED SYSTEM PROMPT FOR HR LOGIC ---
            const systemPrompt = {
                parts: [{
                    text: `You are the SmartHire AI Recruiter. 
                    Your goal is to screen a candidate CV against a Job Description (JD).
                    
                    **SECURITY PROTOCOL:**
                    - The user provided JD text wrapped in <job_description> tags.
                    - The user provided CV text wrapped in <candidate_cv> tags.

                    TASK:
                    1. EXTRACT Job Title and Candidate Name.
                    2. CALCULATE a 'Suitability Score' (0-100).
                       - 90-100: Exceptional match.
                       - 70-89: Good match.
                       - <50: Poor match.
                    3. IDENTIFY 'Skill Gaps' (Red Lines) -> Missing 'Must-Have' skills from JD.
                    4. GENERATE 'Interview Questions' -> Behavioral questions targeting the identified gaps or culture fit.
                    5. COMPARE Line-by-Line: Does the CV evidence the JD requirement?
                    
                    OUTPUT: JSON matching the schema provided.`
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
                jobRole: report.jobRole || 'Untitled Role',
                candidateName: report.candidateName || 'Unknown Candidate',
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
                // FIX: Pass setIsRegistering setter to AuthPage
                return <AuthPage 
                            setCurrentPage={setCurrentPage} 
                            setErrorMessage={setErrorMessage} 
                            errorMessage={errorMessage} 
                            db={db} 
                            auth={auth} 
                            setIsRegistering={setIsRegistering} 
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
                return <AdminDashboard setCurrentPage={setCurrentPage} currentUser={currentUser} reportsHistory={reportsHistory} loadReportFromHistory={loadReportFromHistory} handleLogout={handleLogout} />;
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

// --- TOP LEVEL EXPORT ---
const MainApp = App;

function TopLevelApp() {
    return (
        <ErrorBoundary>
            <MainApp />
        </ErrorBoundary>
    );
}

export default TopLevelApp;
