export type UserLevel = "beginner" | "intermediate" | "advanced" | "expert";

export interface Explanation {
  title: string;
  summary: string;
  detail: string;
  level: UserLevel;
  concepts: string[];
  examples: string[];
  alternatives: AlternativeApproach[];
}

export interface AlternativeApproach {
  description: string;
  pros: string[];
  cons: string[];
  example?: string;
}

interface HarmonyTemplate {
  progression: string[];
  tonicName: string;
  beginnerExplanation: string;
  intermediateExplanation: string;
  advancedExplanation: string;
  expertExplanation: string;
  concepts: string[];
}

interface OrchestrationTemplate {
  instrument: string;
  role: string;
  beginnerExplanation: string;
  intermediateExplanation: string;
  advancedExplanation: string;
  expertExplanation: string;
}

interface FormTemplate {
  formName: string;
  beginnerExplanation: string;
  intermediateExplanation: string;
  advancedExplanation: string;
  expertExplanation: string;
}

const HARMONY_TEMPLATES: HarmonyTemplate[] = [
  {
    progression: ["I", "IV", "V", "I"],
    tonicName: "主-下属-属-主",
    beginnerExplanation:
      "这是最经典的和声进行，就像回家-出门散步-准备回家-回到家的过程。I 和弦给人稳定、回家的感觉，V 和弦让人期待回到 I。",
    intermediateExplanation:
      "I-IV-V-I 是古典音乐中最基本的终止式。IV (下属) 提供色彩变化，V (属) 通过三全音 (tritone) 的解决倾向回到 I。这种进行确立了调性中心。",
    advancedExplanation:
      "I-IV-V-I 体现了 T-S-D-T (Tonic-Subdominant-Dominant-Tonic) 功能循环。IV 到 V 是上行大二度进行，声部进行中常见 soprano 保留共同音。在声部写作中，V7 的七音 (4th scale degree) 应下行解决到 I 的三音。",
    expertExplanation:
      "I-IV-V-I 是西方调性音乐的元进行 (Ur-progression)。在 Schenkerian 分析中对应 I-V-I 背景结构 (Background)，IV 作为前景 (Foreground) 的装饰。V-I 中的导音到主音的倾向性构成了调性引力的物理基础。在和声二元论中，IV 是主音下方的属和弦。",
    concepts: ["调性中心", "功能和声", "终止式", "声部进行"],
  },
  {
    progression: ["I", "V", "vi", "IV"],
    tonicName: "主-属-下中-下属",
    beginnerExplanation:
      "这是流行音乐最常用的和声进行——I-V-vi-IV。它听起来流畅而富有情感，vi 和弦加入了小调的色彩变化，让歌曲有一种温暖而略带忧伤的感觉。",
    intermediateExplanation:
      "I-V-vi-IV 是流行和声的四大进行之一。V 到 vi 是欺骗终止 (deceptive cadence)，避免了强烈的终止感，使音乐能持续流动。vi 的相对小调色彩为进行增加了情感深度。",
    advancedExplanation:
      "I-V-vi-IV 中的 V-vi 构成半终止变体，vi 作为主功能的替代 (tonic substitute)，与 I 共享两个共同音。IV 回 I 是变格终止 (plagal cadence)。这种进行在四小节循环中自然产生了前后呼应。",
    expertExplanation:
      "I-V-vi-IV 的功能序列是 T-D-Tp-S。V-vi 的根音进行是上行大二度，这在 Riemann 功能理论中属于主功能组内部移动。vi 和弦作为主平行和弦 (Tp)，其引入创造了 tonic prolongation 的效果。IV 的回旋完成了功能闭环。",
    concepts: ["欺骗终止", "主功能替代", "流行和声", "循环进行"],
  },
  {
    progression: ["ii", "V", "I"],
    tonicName: "上主-属-主",
    beginnerExplanation:
      "这是爵士乐中最常见的进行 ii-V-I。听起来像是一个完美的问句和答案：提出问题、感到紧张、找到答案。",
    intermediateExplanation:
      "ii-V-I 是爵士乐的核心进行。ii 是下属功能组的代表，提供预备紧张感；V7 通过三全音张力驱动解决；I 是目标。在爵士编曲中常使用扩展音 (9th/11th/13th) 丰富色彩。",
    advancedExplanation:
      "ii-V-I 中 ii 作为 predominat 建立张力累积，V7 的 dominant quality 通过 leading tone tension 解决到 I。在声部进行中，ii7 的七音保留到 V7 的三音，V7 的七音下行解决到 I 的三音，形成平滑的连接。",
    expertExplanation:
      "ii-V-I 是调性引力 (tonal gravity) 的理想模型：S-D-T 功能序列逐步增加 harmonic tension。在 Neo-Riemannian 理论中，ii → V 是 L (Leading-tone exchange) 操作，V → I 是 R (Relative) 操作的逆。在爵士理论中，ii-V 可被三全音替代 (tritone substitution) 为 bII7-V7。",
    concepts: ["功能和声", "声部进行", "属预备", "三全音替代"],
  },
];

const ORCHESTRATION_TEMPLATES: OrchestrationTemplate[] = [
  {
    instrument: "violin",
    role: "旋律/高音线条",
    beginnerExplanation:
      "小提琴声音高亢明亮，所以作曲家通常让它演奏主旋律。就像合唱中的女高音，是音乐中最容易被听到的部分。",
    intermediateExplanation:
      "小提琴在管弦乐队中通常担任旋律声部，利用其宽广的音域和丰富的表现力。高音区的音色明亮穿透力强，中音区温暖抒情。在古典交响乐中，第一小提琴通常演奏旋律，第二小提琴提供和声支撑。",
    advancedExplanation:
      "小提琴的配器决策需要考虑弓法 (bowing) 与乐句结构的对应。上弓 (up-bow) 适合弱起拍和渐强，下弓 (down-bow) 适合重拍和强音。在弦乐四重奏中，小提琴常使用 double stops (双音) 增加厚度，但在快速段落中应避免超过三度的大跳以保持可奏性。",
    expertExplanation:
      "小提琴的 orchestration 需要在 tessitura 与表情之间找到平衡。G 弦 (最低弦) 的音色深沉而富有表现力，适合戏剧性旋律；E 弦 (最高弦) 的音色璀璨。在 19 世纪交响乐写作中，多把小提琴的 divisi (分部) 技术可创造密集的和声织体。连续八度进行需要至少间隔一个八度以避免空洞。",
  },
  {
    instrument: "cello",
    role: "低音支撑/旋律",
    beginnerExplanation:
      "大提琴声音低沉温暖，就像一个深沉的声音在讲故事。它可以演奏低音部分，也可以演奏像人声一样美丽的旋律。",
    intermediateExplanation:
      "大提琴在管弦乐中兼具旋律和低音支撑的双重功能。其音域 (C2-A5) 覆盖了男高音和男低音范围。作为低音弦乐器，它通常与 double bass 形成八度关系巩固和声基础。",
    advancedExplanation:
      "大提琴的配器需要特别注意 register crossing 问题。当大提琴与中提琴在同一八度演奏时，需要通过音色对比或不同的演奏技巧 (arco vs pizzicato) 来分离声部。大提琴的 thumb position (拇指把位) 扩展了高音区表现力。",
    expertExplanation:
      "在晚期浪漫主义和 20 世纪交响乐中，大提琴声部经常使用 divisi 技术创建内部和声。大提琴的 sul ponticello (靠近琴码) 和 sul tasto (靠近指板) 技巧可以产生截然不同的音色效果。double bass 与大提琴的八度关系应避免超过两个八度的间距。",
  },
];

const FORM_TEMPLATES: FormTemplate[] = [
  {
    formName: "奏鸣曲式",
    beginnerExplanation:
      "奏鸣曲式像是一场戏剧的三幕结构：呈示部介绍主题，发展部探索和变化这些主题，再现部把一切都带回来。",
    intermediateExplanation:
      "奏鸣曲式包含三个主要部分：呈示部 (Exposition)、发展部 (Development) 和再现部 (Recapitulation)。呈示部通常包含第一主题 (主调) 和第二主题 (属调)，两者通过过渡段连接。发展部对主题材料进行加工变形。",
    advancedExplanation:
      "在呈示部中，第一主题组 (primary theme group) 通常在主调上，第二主题组 (secondary theme group) 经过转调到属调或关系大调。Coda (尾声) 可以视为第四部分，对整首乐章进行总结。发展的方式包括动机分裂 (motivic fragmentation)、模进 (sequence) 和对位处理。",
    expertExplanation:
      "奏鸣曲式的深层结构在 Schenkerian 分析中体现为 I-V-I 的 Urlinie 背景，与调性区域内的 dissonance-resolution 辩证过程相对应。发展部通常探索远关系调，并在属准备 (dominant pedal) 上为再现部的回归做铺垫。在海顿和贝多芬的晚期作品中，发展部常包含伪再现 (false recapitulation) 技巧。",
  },
  {
    formName: "三段体 (ABA)",
    beginnerExplanation:
      "三段体就像汉堡包：A 是上面的面包，B 是中间的肉饼，A 是底下的面包。回到的 A 和开始时的 A 通常是一样的。",
    intermediateExplanation:
      "ABA 形式是最基本的曲式结构之一。A 段建立主题性格，B 段 (Trio/Middle section) 提供对比，可以转到属调或平行小调。再现的 A 段可以精确重复或做变奏处理 (A')。",
    advancedExplanation:
      "在 Da Capo Aria 中，ABA 形式包含了即兴装饰 (ornamentation) 的传统——再现 A 段时，演唱者会加入华彩段落。在古典交响曲的 Scherzo 中，ABA 结构经常附有 Coda。B 段的调性布局通常从主调的属关系调开始，随后回到主调。",
    expertExplanation:
      "ABA 形式的深层美学在于同一性的辩证回归。经历 B 段后回归的 A 不再是简单的重复，而是一种 transformed return——音乐时间的非线性体验。在 Mahler 的交响乐中，回归可以是不完整的或变形的 (verfremdet)，产生了一种 ironic nostalgia 的效果。",
  },
];

const DECISION_TEMPLATES: Record<
  string,
  {
    beginnerExplanation: string;
    intermediateExplanation: string;
    advancedExplanation: string;
    expertExplanation: string;
  }
> = {
  reflowLayout: {
    beginnerExplanation:
      "我们重新排列了乐谱的布局，让每个音符都有足够的空间，就像给每个字母留出位置让你轻松阅读一样。",
    intermediateExplanation:
      "乐谱重排优化了系统断行 (system break)、小节宽度 (bar width) 和音符间距 (note spacing)，确保每个声部清晰可读，同时遵循所选乐谱风格 (如 Henle/Schirmer) 的排版惯例。",
    advancedExplanation:
      "排版引擎使用基于 duration-proportional 间距算法，同时考虑 stem direction、beam grouping 和 accidental placement。系统断行位置避免在连线 (slur) 中途断开，并优先在乐句边界处换行。",
    expertExplanation:
      "乐谱排版的数学基础是 Gourlay (1986) 的 optimal line breaking 算法与 Rastall 最小间距准则的结合。具体决策涉及 penalty scoring：在乐句中途断行的 penalty 远高于小节线处；符杠 (beam) 跨行的 penalty 更高。accidental 堆叠算法使用垂直方向的 collision avoidance。",
  },
  generateMotif: {
    beginnerExplanation:
      "旋律动机就像一首歌的种子——一小段旋律，之后整首曲子都会围绕它来发展。",
    intermediateExplanation:
      "生成的旋律动机基于所选音阶，使用有限度的音程跳跃和节奏变化来保持旋律的自然流畅。乐句通常以主音或属音结束以建立稳定感。",
    advancedExplanation:
      "动机生成采用马尔可夫链模型 (Markov chain)，转移概率由所选风格 (style hint) 决定。音程分布、节奏密度和 register 范围是受控参数。生成结果通过 tension-release 曲线验证乐句的弧线结构。",
    expertExplanation:
      "动机生成器内部使用 weighted random walk on pitch-class set，权重来自 Schenkerian Ursatz 的音级重要性。每个音级的概率密度函数是上下文感知的——考虑前两个音程的累积方向以避免单调性。音程的 transition entropy 可调，以在新颖性与一致性之间取得平衡。",
  },
  voicingPlan: {
    beginnerExplanation:
      "配器就像给一幅画添上颜色——我们决定每个乐器演奏哪些音符，让它们在一起听起来和谐动听。",
    intermediateExplanation:
      "配器方案根据目标乐器组的音域、演奏能力和和声角色来分配音符。优先保持各声部的独立性，避免声部交叉 (voice crossing) 和空旷位置 (hollow spacing)。",
    advancedExplanation:
      "声部分配使用 constraint-satisfaction 方法：每个乐器的 tessitura 舒适区作为硬约束，声部进行 (voice leading) 的平滑性作为软约束。和声的开放/密集排列 (open/close voicing) 取决于音区布局。",
    expertExplanation:
      "编排决策基于 Adriaansz 的配器梯度模型：低音区使用阔间距 (open spacing) 避免 muddiness；高音区可使用密集排列 (close voicing) 增加 sonority。声部的 textural differentiation 通过攻击点密度和动态分层的协同实现。在爵士编排中，drop-2/drop-4 voicing 技术是标准手法。",
  },
};

function selectLevelExplanation(
  templates: [UserLevel, string][]
): string {
  return templates[templates.length - 1][1];
}

function explanationForLevel(
  beginner: string,
  intermediate: string,
  advanced: string,
  expert: string,
  targetLevel: UserLevel
): string {
  switch (targetLevel) {
    case "beginner":
      return beginner;
    case "intermediate":
      return intermediate;
    case "advanced":
      return advanced;
    case "expert":
      return expert;
  }
}

function getAllLevelExplanations(
  beginner: string,
  intermediate: string,
  advanced: string,
  expert: string
): Record<UserLevel, string> {
  return { beginner, intermediate, advanced, expert };
}

const LEVEL_ORDER: UserLevel[] = ["beginner", "intermediate", "advanced", "expert"];

function levelIndex(level: UserLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

export class TeachingAgent {
  explainDecision(
    diffId: string,
    userLevel: UserLevel,
    compareWithAlt?: boolean
  ): Explanation {
    const templateKey = this.matchDiffType(diffId);
    const tmpl = DECISION_TEMPLATES[templateKey] ?? DECISION_TEMPLATES["generateMotif"];
    const detail = explanationForLevel(
      tmpl!.beginnerExplanation,
      tmpl!.intermediateExplanation,
      tmpl!.advancedExplanation,
      tmpl!.expertExplanation,
      userLevel
    );

    const title = this.decisionTitle(templateKey);
    const concepts = this.decisionConcepts(templateKey, userLevel);
    const examples = this.decisionExamples(templateKey, userLevel);
    const alternatives: AlternativeApproach[] = compareWithAlt
      ? this.decisionAlternatives(templateKey)
      : [];

    return {
      title,
      summary: this.buildSummary(templateKey, userLevel),
      detail,
      level: userLevel,
      concepts,
      examples,
      alternatives,
    };
  }

  explainHarmony(
    chordProgression: string[],
    key: string,
    userLevel: UserLevel
  ): Explanation {
    const match = this.matchHarmonyTemplate(chordProgression);

    const detail = match
      ? explanationForLevel(
          match.beginnerExplanation,
          match.intermediateExplanation,
          match.advancedExplanation,
          match.expertExplanation,
          userLevel
        )
      : this.genericHarmonyExplanation(chordProgression, key, userLevel);

    const concepts = match?.concepts ?? ["和声", "和弦进行", "调性"];

    return {
      title: `和声进行分析: ${key} ${chordProgression.join("-")}`,
      summary: this.harmonySummary(chordProgression, key, userLevel),
      detail,
      level: userLevel,
      concepts,
      examples: this.harmonyExamples(userLevel),
      alternatives: this.harmonyAlternatives(chordProgression, key),
    };
  }

  explainOrchestration(
    instrumentChoices: string[],
    context: string,
    userLevel: UserLevel
  ): Explanation {
    const instrumentDetails = instrumentChoices
      .map((inst) => {
        const tmpl = ORCHESTRATION_TEMPLATES.find((t) => t.instrument === inst);
        return tmpl
          ? explanationForLevel(
              tmpl.beginnerExplanation,
              tmpl.intermediateExplanation,
              tmpl.advancedExplanation,
              tmpl.expertExplanation,
              userLevel
            )
          : `${inst} 是常用乐器`;
      })
      .join("\n\n");

    return {
      title: `配器方案: ${instrumentChoices.join(", ")} - ${context}`,
      summary:
        userLevel === "beginner"
          ? `${instrumentChoices.length} 种乐器被选中，它们会一起演奏，就像一个小乐队。`
          : `已选择 ${instrumentChoices.length} 种乐器：${instrumentChoices.join("、")}，基于 ${context} 配器需求。`,
      detail: instrumentDetails,
      level: userLevel,
      concepts:
        userLevel === "beginner"
          ? ["乐器", "合奏"]
          : userLevel === "intermediate"
            ? ["配器", "声部", "乐器编制"]
            : ["orchestration", "instrumentation", "tessitura", "timbre blending"],
      examples: this.orchestrationExamples(userLevel),
      alternatives: this.orchestrationAlternatives(instrumentChoices),
    };
  }

  explainForm(sections: string[], userLevel: UserLevel): Explanation {
    const formName = this.identifyFormName(sections);
    const tmpl = FORM_TEMPLATES.find((t) => t.formName === formName);

    const detail = tmpl
      ? explanationForLevel(
          tmpl.beginnerExplanation,
          tmpl.intermediateExplanation,
          tmpl.advancedExplanation,
          tmpl.expertExplanation,
          userLevel
        )
      : this.genericFormExplanation(sections, userLevel);

    return {
      title: `曲式分析: ${formName} (${sections.join(" - ")})`,
      summary:
        userLevel === "beginner"
          ? `这首曲子分为 ${sections.length} 个部分，就像故事有开头、中间和结尾。`
          : `${formName} 形式，包含 ${sections.length} 个段落：${sections.join(", ")}`,
      detail,
      level: userLevel,
      concepts:
        userLevel === "beginner"
          ? ["曲式", "段落"]
          : ["曲式结构", "调性布局", "主题对比", "再现"],
      examples: this.formExamples(userLevel),
      alternatives: [],
    };
  }

  adaptExplanation(explanation: Explanation, targetLevel: UserLevel): Explanation {
    if (explanation.level === targetLevel) return explanation;

    return {
      ...explanation,
      level: targetLevel,
      summary: this.adaptSummary(explanation.summary, targetLevel),
      detail: this.adaptDetail(explanation.detail, explanation.level, targetLevel),
    };
  }

  generateAlternatives(
    context: { style: string; key: string; bars: number },
    userLevel: UserLevel
  ): AlternativeApproach[] {
    const style = context.style.toLowerCase();

    if (style.includes("classical") || style.includes("交响")) {
      return [
        {
          description: "使用对比主题 (contrasting theme)",
          pros: ["增加戏剧性", "建立二元对立", "符合奏鸣曲式传统"],
          cons: ["需要额外的动机素材", "可能导致结构过于复杂"],
          example: "Beethoven Symphony No.5 第一和第二主题",
        },
        {
          description: "使用变奏手法 (theme and variations)",
          pros: ["保持统一性", "逐步展开素材", "技术性展示空间大"],
          cons: ["需要足够多的变化手段", "可能显得重复"],
          example: "Mozart K.265 '小星星变奏曲'",
        },
      ];
    }

    if (style.includes("jazz")) {
      return [
        {
          description: "使用 ii-V-I 循环模进",
          pros: ["自然的和声流动", "即兴空间充分", "爵士风格纯正"],
          cons: ["可能缺乏色彩变化", "容易落入俗套"],
          example: "Autumn Leaves changes",
        },
        {
          description: "使用 Coltrane Changes (大三度循环)",
          pros: ["非常规的和声色彩", "扩展即兴语言", "突破传统局限"],
          cons: ["调性中心模糊", "对和声理解要求高"],
          example: "Giant Steps",
        },
      ];
    }

    return [
      {
        description: "8小节标准乐段结构",
        pros: ["清晰的结构", "容易跟进", "适合多种风格"],
        cons: ["可能缺乏新意"],
      },
      {
        description: "自由曲式 (through-composed)",
        pros: ["最大创作自由度", "不受传统约束"],
        cons: ["缺乏结构性记忆点", "听众难以跟进"],
      },
    ];
  }

  private matchDiffType(diffId: string): string {
    if (diffId.includes("reflow") || diffId.includes("engraving") || diffId.includes("layout")) {
      return "reflowLayout";
    }
    if (diffId.includes("motif") || diffId.includes("compose")) {
      return "generateMotif";
    }
    if (diffId.includes("voicing") || diffId.includes("orches")) {
      return "voicingPlan";
    }
    return "generateMotif";
  }

  private decisionTitle(templateKey: string): string {
    const titles: Record<string, string> = {
      reflowLayout: "乐谱排版决策说明",
      generateMotif: "旋律动机生成决策说明",
      voicingPlan: "配器编排决策说明",
    };
    return titles[templateKey] ?? "决策说明";
  }

  private decisionConcepts(templateKey: string, level: UserLevel): string[] {
    const conceptMap: Record<string, Record<UserLevel, string[]>> = {
      reflowLayout: {
        beginner: ["乐谱", "排版", "可读性"],
        intermediate: ["制谱", "系统断行", "音符间距", "符干方向"],
        advanced: ["engraving", "proportional spacing", "beam grouping", "collision avoidance"],
        expert: ["Gourlay algorithm", "optical kerning", "accidental stacking", "Rastall spacing"],
      },
      generateMotif: {
        beginner: ["旋律", "动机", "节奏"],
        intermediate: ["动机发展", "音阶", "调性", "乐句结构"],
        advanced: ["马尔可夫链", "音程分布", "乐句弧线", "tension-release"],
        expert: ["pitch-class set", "Schenkerian Ursatz", "transition entropy", "harmonic rhythm"],
      },
      voicingPlan: {
        beginner: ["乐器", "合奏", "和声"],
        intermediate: ["配器", "声部", "音域", "声部进行"],
        advanced: ["voicing", "tessitura", "voice leading", "density"],
        expert: ["orchestration gradient", "spectral balance", "textural differentiation", "drop voicing"],
      },
    };
    return conceptMap[templateKey]?.[level] ?? conceptMap["generateMotif"]![level];
  }

  private decisionExamples(templateKey: string, level: UserLevel): string[] {
    if (level === "beginner") {
      return ["就像一首新歌的哼唱开头，简单但吸引人。"];
    }
    if (level === "intermediate") {
      return [`${templateKey} 操作处理了多个小节的内容，应用了标准音乐理论原则。`];
    }
    if (level === "advanced") {
      return ["如 Beethoven Op.27 No.2 第一乐章，持续的分解和弦模式贯穿全曲。"];
    }
    return [
      "Wagner: Tristan und Isolde 前奏曲中的 leitmotif transformation 展示了动机的无限发展可能。",
      "Bartók: Music for Strings, Percussion and Celesta 中使用了对称动机结构。",
    ];
  }

  private decisionAlternatives(templateKey: string): AlternativeApproach[] {
    if (templateKey === "reflowLayout") {
      return [
        {
          description: "不自动换行，使用紧凑排列",
          pros: ["节省页面空间", "减少翻页次数"],
          cons: ["可读性降低", "可能产生音符重叠"],
        },
      ];
    }
    return [];
  }

  private buildSummary(templateKey: string, level: UserLevel): string {
    if (level === "beginner") {
      return "以下是关于这个操作的简单解释，用日常语言描述的。";
    }
    return `以下是关于 ${templateKey} 决策的详细分析（${level} 级别）。`;
  }

  private matchHarmonyTemplate(chordProgression: string[]): HarmonyTemplate | undefined {
    for (const tmpl of HARMONY_TEMPLATES) {
      if (tmpl.progression.length === chordProgression.length) {
        const match = tmpl.progression.every(
          (c, i) => c.replace(/[0-9°]/g, "") === chordProgression[i]!.replace(/[0-9°]/g, "")
        );
        if (match) return tmpl;
      }
    }
    return undefined;
  }

  private genericHarmonyExplanation(
    chordProgression: string[],
    key: string,
    level: UserLevel
  ): string {
    if (level === "beginner") {
      return `这个和弦进行使用 ${key} 调的和弦：${chordProgression.join(" → ")}。每个和弦都给音乐带来不同的情绪和色彩变化。`;
    }
    if (level === "intermediate") {
      return `和弦进行 ${chordProgression.join("-")} 在 ${key} 调中。这个进行包含了 ${chordProgression.length} 个和弦，展现了功能性和声的基本逻辑。`;
    }
    return `和弦进行 ${chordProgression.join("-")} 在 ${key} 调中。每个和弦的声部进行遵循最小运动原则 (law of minimal motion)，共同音 (common tone) 尽可能保留，变化音以级进方式移动。`;
  }

  private harmonySummary(
    chordProgression: string[],
    key: string,
    level: UserLevel
  ): string {
    if (level === "beginner") {
      return `${key} 调的和弦进行 ${chordProgression.join("-")}，就像音乐的"路线图"。`;
    }
    return `${key} 调：${chordProgression.join(" → ")} 和声进行分析`;
  }

  private harmonyExamples(level: UserLevel): string[] {
    if (level === "beginner") {
      return ["很多流行歌曲都使用这个进行，比如 Let It Be。"];
    }
    return ["Bach: Prelude in C Major BWV 846", "Pachelbel: Canon in D"];
  }

  private harmonyAlternatives(
    chordProgression: string[],
    key: string
  ): AlternativeApproach[] {
    return [
      {
        description: `使用替代和弦增强色彩`,
        pros: ["增加和声丰富度", "制造意外效果"],
        cons: ["可能偏离调性中心", "声部进行需要调整"],
        example: `用 ii 替代 IV，用 vi 替代 I`,
      },
    ];
  }

  private orchestrationExamples(level: UserLevel): string[] {
    if (level === "beginner") {
      return ["就像学校乐队：长笛吹旋律，鼓打节奏，大提琴弹低音。"];
    }
    return ["Ravel: Bolero (渐进式配器示范)", "Mahler Symphony No.5 第四乐章 Adagietto"];
  }

  private orchestrationAlternatives(
    instrumentChoices: string[]
  ): AlternativeApproach[] {
    const alts: AlternativeApproach[] = [];

    if (instrumentChoices.includes("violin")) {
      alts.push({
        description: "使用 flute 替代 violin 的高音旋律",
        pros: ["音色更轻盈", "穿透力更强"],
        cons: ["无法演奏 double stops", "低音区表现力不如弦乐"],
      });
    }

    if (instrumentChoices.includes("piano")) {
      alts.push({
        description: "使用 harp 替代 piano 的分解和弦",
        pros: ["音色更梦幻", "增加管弦乐色彩"],
        cons: ["半音限制", "力度范围较小"],
      });
    }

    return alts;
  }

  private identifyFormName(sections: string[]): string {
    if (sections.length === 3 && sections[0] === sections[2]) return "三段体 (ABA)";
    if (sections.length >= 3) return "奏鸣曲式";
    if (sections.length === 2) return "二段体 (AB)";
    return "自由曲式";
  }

  private genericFormExplanation(sections: string[], level: UserLevel): string {
    if (level === "beginner") {
      return `这首曲子有 ${sections.length} 个段落：${sections.join(", ")}。每个段落都有自己的特点，就像故事的不同章节。`;
    }
    return `${sections.length} 段落结构，以 ${sections.join(" → ")} 的顺序展开。`;
  }

  private formExamples(level: UserLevel): string[] {
    if (level === "beginner") {
      return ["像 '小星星' 一样，有开始、中间和结尾部分。"];
    }
    return [
      "Mozart: Eine kleine Nachtmusik K.525 (奏鸣曲式)",
      "Chopin: Nocturne Op.9 No.2 (三段体)",
    ];
  }

  private adaptSummary(summary: string, targetLevel: UserLevel): string {
    if (targetLevel === "beginner") {
      return summary.replace(/马尔可夫链|tension-release|Schenkerian|voicing|tessitura/gi, "简单规则");
    }
    return summary;
  }

  private adaptDetail(
    detail: string,
    fromLevel: UserLevel,
    targetLevel: UserLevel
  ): string {
    if (levelIndex(targetLevel) < levelIndex(fromLevel)) {
      return detail
        .replace(/马尔可夫链模型/g, "随机算法")
        .replace(/Schenkerian\s+Ursatz/g, "基本音级")
        .replace(/tension-release\s+曲线/g, "情绪的起伏")
        .replace(/transition\s+entropy/g, "变化程度")
        .replace(/constraint-satisfaction/g, "规则匹配")
        .replace(/tessitura舒适区/g, "合适的音域");
    }
    if (levelIndex(targetLevel) > levelIndex(fromLevel)) {
      return detail + "\n\n如需更深入的技术分析，请使用高级/专家模式。";
    }
    return detail;
  }
}
