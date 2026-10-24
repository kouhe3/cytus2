// Synthetic Il2CppDumper output for the canonical DB fixtures.
// Only the class/const shapes the story-node extractor reads are present.

// Namespace: Rayark.Cytus2.Story
public class StoryAlpha01 // TypeDefIndex: 9001
{
	// Fields
	public const string ID = "story_alpha01";
	public const string STEP_START = "0_TOUCH_IM_POST_AL0101";

	// Properties
	private string Rayark.Cytus2.Story.IStoryActionBossStage.BossStage { get; }
}

// Namespace: Rayark.Cytus2.Story
public class StoryAlpha01Action : IStoryActionBossStage // TypeDefIndex: 9002
{
	// Fields
	public const string BOSS_STAGE_ID = "alpha_bossstage";
	public const string BOSS_SONGPACK_ID = "alpha001";
	public const string BOSS_SONG_ID = "alpha001_000";
	public const string MOVIE_FILE = "alpha.mp4";

	// Properties
	private string Rayark.Cytus2.Story.ICutscene.FileName { get; }
}

// Namespace: Rayark.Cytus2.Story
public class StoryEnding03Main // TypeDefIndex: 9003
{
	// Fields
	public const string ID = "story_ending03_main";
	public const string STEP_START = "0_TOUCH_OS_POST";
	public const string TRIGGER_GALLERY_FOLDER_ID = "misc";
	public const string TRIGGER_GALLERY_FILE_LOCATION = "opening";

	// Properties
	private bool Rayark.Cytus2.Story.ICutscene.CanSkip { get; }
}

// Namespace: Rayark.Cytus2.Story
public class StoryEnding03MainAction : IStoryActionBossStage // TypeDefIndex: 9004
{
	// Fields
	public const string BOSS_STAGE_ID = "vanessa_v";

	// Properties
	private string Rayark.Cytus2.Story.IStoryActionBossStage.BossStage { get; }
}

// Namespace: Rayark.Cytus2.Story
public class StoryVanessa04 // TypeDefIndex: 9005
{
	// Fields
	public const string ID = "story_vanessa04";
	public const string STEP_START = "0_TOUCH_OS_POST";

	// Properties
	private bool Rayark.Cytus2.Story.ICutscene.CanSkip { get; }
}

// Namespace: Rayark.Cytus2.Story
public class StoryVanessa04Action : IStoryActionBossStage // TypeDefIndex: 9006
{
	// Fields
	public const string BOSS_STAGE_ID = "vos061_bossstage";

	// Properties
	private string Rayark.Cytus2.Story.IStoryActionBossStage.BossStage { get; }
}
