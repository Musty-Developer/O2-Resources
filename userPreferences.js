export const SYLLABUSES = [
    { id: 'ig-ol-islamiyat', label: 'IG/OL Islamiyat' },
    { id: 'ig-ol-pakistan-studies', label: 'IG/OL Pakistan Studies' },
    { id: 'igcse-urdu-sl', label: 'IGCSE Urdu as a Second Language', disallowOctNov: true },
    { id: 'ol-urdu-sl', label: 'OL Urdu as a Second Language' },
    { id: 'ol-urdu-fl', label: 'OL Urdu First Language', disallowOctNov: true },
];

export const EXAM_SERIES = [
    { id: 'oct-nov-2026', label: 'Oct/Nov 2026' },
    { id: 'may-june-2027', label: 'May/June 2027' },
    { id: 'oct-nov-2027', label: 'Oct/Nov 2027' },
];

export const PREFS_VERSION = 1;

export const prefsStorageKey = (userId) => `o2_syllabus_prefs_${userId}`;

export const createEmptyPreferences = () => ({
    version: PREFS_VERSION,
    onboardingComplete: false,
    examPlans: [],
    updatedAt: null,
});

// NEW HELPER: Checks if a subject is legally allowed in a specific series
export const isSubjectAllowedInSeries = (subjectId, seriesId) => {
    const subject = SYLLABUSES.find(s => s.id === subjectId);
    if (!subject) return false;
    if (subject.disallowOctNov && seriesId.includes('oct-nov')) return false;
    return true;
};

export const normalizePreferences = (raw) => {
    if (!raw || typeof raw !== 'object') return createEmptyPreferences();

    const validSeriesIds = new Set(EXAM_SERIES.map((series) => series.id));
    const validSubjectIds = new Set(SYLLABUSES.map((subject) => subject.id));

    const examPlans = Array.isArray(raw.examPlans)
        ? raw.examPlans
            .filter((plan) => plan && validSeriesIds.has(plan.seriesId) && Array.isArray(plan.subjectIds))
            .map((plan) => {
                const isOctNov = plan.seriesId.includes('oct-nov');
                return {
                    seriesId: plan.seriesId,
                    subjectIds: [...new Set(plan.subjectIds.filter((id) => {
                        if (!validSubjectIds.has(id)) return false;
                        
                        // CONSTRAINT CHECK: Strip out restricted subjects from Oct/Nov plans
                        const subjectDef = SYLLABUSES.find(s => s.id === id);
                        if (isOctNov && subjectDef?.disallowOctNov) return false;
                        
                        return true;
                    }))],
                };
            })
            .filter((plan) => plan.subjectIds.length > 0)
        : [];

    const assignedSubjects = new Set();
    const dedupedPlans = [];

    examPlans.forEach((plan) => {
        const subjectIds = plan.subjectIds.filter((subjectId) => {
            if (assignedSubjects.has(subjectId)) return false;
            assignedSubjects.add(subjectId);
            return true;
        });

        if (subjectIds.length > 0) {
            dedupedPlans.push({ seriesId: plan.seriesId, subjectIds });
        }
    });

    return {
        version: PREFS_VERSION,
        onboardingComplete: !!raw.onboardingComplete,
        examPlans: dedupedPlans,
        updatedAt: raw.updatedAt ?? null,
    };
};

export const getSubjectSeriesMap = (examPlans) => {
    const map = {};
    examPlans.forEach((plan) => {
        plan.subjectIds.forEach((subjectId) => {
            map[subjectId] = plan.seriesId;
        });
    });
    return map;
};

export const getSyllabusLabel = (id) => SYLLABUSES.find((subject) => subject.id === id)?.label ?? id;

export const getSeriesLabel = (id) => EXAM_SERIES.find((series) => series.id === id)?.label ?? id;

export const getConfiguredPlans = (examPlans) => examPlans.filter((plan) => plan.subjectIds.length > 0);

export const loadUserPreferences = async (userId, user = null) => {
    const metadataPrefs = user?.user_metadata?.syllabus_preferences;
    if (metadataPrefs) {
        const normalized = normalizePreferences(metadataPrefs);
        localStorage.setItem(prefsStorageKey(userId), JSON.stringify(normalized));
        return normalized;
    }

    const cached = localStorage.getItem(prefsStorageKey(userId));
    if (cached) {
        try {
            return normalizePreferences(JSON.parse(cached));
        } catch {
            return createEmptyPreferences();
        }
    }

    return createEmptyPreferences();
};

export const saveUserPreferences = async (userId, prefs, supabaseClient) => {
    const payload = normalizePreferences({
        ...prefs,
        updatedAt: new Date().toISOString(),
    });

    localStorage.setItem(prefsStorageKey(userId), JSON.stringify(payload));

    if (supabaseClient) {
        const { error } = await supabaseClient.auth.updateUser({
            data: { syllabus_preferences: payload },
        });
        if (error) throw error;
    }

    return payload;
};
