"""Generate the checked-in, standalone single-target watchOS project. No third-party generator."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'watch'
project=root/'MarathonTracker.xcodeproj'
project.mkdir(exist_ok=True)
files=sorted((root/'MarathonTracker').glob('*.swift'))
def ident(n): return f'{n:024X}'
objects=[]
def add(n,body):objects.append(f'{ident(n)} = {{ {body} }};')
for i,p in enumerate(files):
 add(100+i,f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {p.name}; sourceTree = "<group>";')
 add(200+i,f'isa = PBXBuildFile; fileRef = {ident(100+i)};')
add(10,'isa = PBXFileReference; explicitFileType = wrapper.application; path = MarathonTracker.app; sourceTree = BUILT_PRODUCTS_DIR;')
add(11,'isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Project.xcconfig; sourceTree = "<group>";')
add(12,'isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>";')
add(1,f'isa = PBXGroup; children = ({ident(2)},{ident(3)},{ident(11)}); sourceTree = "<group>";')
add(2,f'isa = PBXGroup; children = ({",".join(ident(100+i) for i in range(len(files)))},{ident(12)}); path = MarathonTracker; sourceTree = "<group>";')
add(3,f'isa = PBXGroup; children = ({ident(10)}); name = Products; sourceTree = "<group>";')
add(20,f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({",".join(ident(200+i) for i in range(len(files)))}); runOnlyForDeploymentPostprocessing = 0;')
add(21,'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
add(22,'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
add(30,f'isa = PBXNativeTarget; buildConfigurationList = {ident(41)}; buildPhases = ({ident(20)},{ident(21)},{ident(22)}); buildRules = (); dependencies = (); name = MarathonTracker; productName = MarathonTracker; productReference = {ident(10)}; productType = "com.apple.product-type.application";')
add(31,f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 1600; TargetAttributes = {{ {ident(30)} = {{ CreatedOnToolsVersion = 16.0; SystemCapabilities = {{ com.apple.BackgroundModes = {{ enabled = 1; }}; }}; }}; }}; }}; buildConfigurationList = {ident(40)}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; knownRegions = (en,Base); mainGroup = {ident(1)}; productRefGroup = {ident(3)}; projectDirPath = ""; projectRoot = ""; targets = ({ident(30)});')
for config,name in [(50,'Debug'),(51,'Release')]:
 add(config,f'isa = XCBuildConfiguration; buildSettings = {{ CLANG_ENABLE_MODULES = YES; SDKROOT = watchos; WATCHOS_DEPLOYMENT_TARGET = 11.0; SWIFT_VERSION = 6.0; SWIFT_STRICT_CONCURRENCY = complete; SWIFT_OPTIMIZATION_LEVEL = {"\"-Onone\"" if name=="Debug" else "\"-O\""}; }}; name = {name};')
for config,name in [(52,'Debug'),(53,'Release')]:
 add(config,f'isa = XCBuildConfiguration; baseConfigurationReference = {ident(11)}; buildSettings = {{ CODE_SIGN_STYLE = Automatic; INFOPLIST_FILE = MarathonTracker/Info.plist; GENERATE_INFOPLIST_FILE = NO; PRODUCT_NAME = "$(TARGET_NAME)"; TARGETED_DEVICE_FAMILY = 4; SDKROOT = watchos; SUPPORTED_PLATFORMS = "watchos watchsimulator"; WATCHOS_DEPLOYMENT_TARGET = 11.0; SKIP_INSTALL = NO; SWIFT_VERSION = 6.0; }}; name = {name};')
for n,configs in [(40,[50,51]),(41,[52,53])]:add(n,f'isa = XCConfigurationList; buildConfigurations = ({",".join(ident(c) for c in configs)}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
(project/'project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+'\n'.join(objects)+f'\n}}; rootObject = {ident(31)}; }}\n')
scheme=project/'xcshareddata/xcschemes';scheme.mkdir(parents=True,exist_ok=True)
(scheme/'MarathonTracker.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ident(30)}" BuildableName="MarathonTracker.app" BlueprintName="MarathonTracker" ReferencedContainer="container:MarathonTracker.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ident(30)}" BuildableName="MarathonTracker.app" BlueprintName="MarathonTracker" ReferencedContainer="container:MarathonTracker.xcodeproj"/></BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release"/><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>''')
